import type {
  ApiErrorResponse,
  ActiveTripResponse,
  AuthenticatedActor,
  AuthenticationResponse,
  CancellationReasonCode,
  CancelTripResponse,
  DispatchMatchResponse,
  DeliveryMatchResponse,
  DeliveryOfferResponse,
  DeliveryRealtimeSnapshot,
  DeliveryResponse,
  DriverLocationSnapshot,
  DriverWorkState,
  FareQuoteResponse,
  FareQuoteRoute,
  PaymentAttemptResponse,
  ReadinessResponse,
  RegistrationResponse,
  TripDetailResponse,
  TripHistoryItem,
  TripOfferResponse,
  TripResponse,
  TripRealtimeSnapshot,
} from '@gove/contracts';
import {
  ArrowLeft,
  ArrowRight,
  Broadcast,
  CarProfile,
  CheckCircle,
  MapPin,
  Motorcycle,
  NavigationArrow,
  Package,
  ShieldCheck,
  SignOut,
  SteeringWheel,
  UserCircle,
} from '@phosphor-icons/react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Map as MapLibreMap, Marker as MapLibreMarker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';

type ApiState =
  | { status: 'checking' }
  | { status: 'ready'; details: ReadinessResponse }
  | { status: 'unavailable' };
type Page =
  | 'home'
  | 'register'
  | 'sign-in'
  | 'account'
  | 'driver-setup'
  | 'driver-console'
  | 'ride-request'
  | 'delivery-request';
type RequestState =
  | { state: 'idle' }
  | { state: 'submitting' }
  | { state: 'error'; message: string };
type AuthBootstrapState = 'checking' | 'ready';
type RealtimeMessage = {
  type: string;
  snapshot?: TripRealtimeSnapshot | DeliveryRealtimeSnapshot;
  tripId?: string;
  deliveryId?: string;
  eventId?: string;
  aggregateVersion?: number;
  driverId?: string;
  latitude?: number;
  longitude?: number;
  accuracyMeters?: number;
  capturedAt?: string;
  receivedAt?: string;
  payload?: unknown;
  message?: string;
};

type DeliveryDriverLocation = DriverLocationSnapshot & {
  driverId: string;
};

type DriverMapPoint = MapPoint & {
  observedAt: string;
};

type MapLibreModule = typeof import('maplibre-gl');

const deliveryLiveLocationWindowMilliseconds = 15_000;
const driverMarkerAnimationMaximumGapMilliseconds = 10_000;
const driverMarkerAnimationMaximumDurationMilliseconds = 1_200;
const mapLibreStyleUrl = import.meta.env.VITE_MAPLIBRE_STYLE_URL?.trim();
const mapLibreWorkerUrl = new URL(
  'maplibre-gl/dist/maplibre-gl-worker.mjs',
  import.meta.url,
).toString();

const hanoiInnerCityDemoLocations = {
  ride: {
    pickup: {
      label: 'Hồ Hoàn Kiếm, Hoàn Kiếm',
      latitude: '21.0284',
      longitude: '105.8542',
    },
    dropoff: {
      label: 'Văn Miếu - Quốc Tử Giám, Đống Đa',
      latitude: '21.0276',
      longitude: '105.8355',
    },
  },
  delivery: {
    pickup: {
      label: 'Nhà hát Lớn Hà Nội, Hoàn Kiếm',
      latitude: '21.0245',
      longitude: '105.8576',
    },
    dropoff: {
      label: 'Ga Hà Nội, Đống Đa',
      latitude: '21.0245',
      longitude: '105.8412',
    },
  },
} as const;

const roles = [
  {
    icon: UserCircle,
    label: 'Khách hàng',
    description: 'Đặt chuyến và theo dõi rõ ràng từng cập nhật quan trọng.',
  },
  {
    icon: SteeringWheel,
    label: 'Tài xế',
    description: 'Khai báo hồ sơ và phương tiện trước khi nhận chuyến.',
  },
  {
    icon: Broadcast,
    label: 'Điều hành',
    description: 'Theo dõi sức khoẻ hệ thống và lịch sử xử lý chuyến.',
  },
] as const;

const customerCancellationReasons: ReadonlyArray<{
  code: CancellationReasonCode;
  label: string;
}> = [
  { code: 'CHANGE_OF_PLANS', label: 'Thay đổi kế hoạch' },
  { code: 'DRIVER_DELAY', label: 'Tài xế đến chậm' },
  {
    code: 'DRIVER_REQUESTED_CANCELLATION',
    label: 'Tài xế đề nghị hủy chuyến',
  },
  { code: 'SAFETY_CONCERN', label: 'Lo ngại về an toàn' },
  { code: 'VEHICLE_ISSUE', label: 'Vấn đề với phương tiện' },
  { code: 'OTHER', label: 'Lý do khác' },
];

function pageFromLocation(): Page {
  const path = window.location.pathname;
  if (path === '/register') return 'register';
  if (path === '/sign-in') return 'sign-in';
  if (path === '/account') return 'account';
  if (path === '/driver/setup') return 'driver-setup';
  if (path === '/driver/console') return 'driver-console';
  if (path === '/ride/request') return 'ride-request';
  if (path === '/delivery/request') return 'delivery-request';
  return 'home';
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  const response = await fetch(`/api/v1${path}`, {
    ...options,
    credentials: 'include',
    headers,
  });
  if (!response.ok) {
    const fallback = 'Có lỗi xảy ra. Vui lòng thử lại.';
    const error = (await response
      .json()
      .catch(() => null)) as ApiErrorResponse | null;
    throw new Error(toUserFacingError(error?.code, error?.message, fallback));
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function toUserFacingError(
  code: string | undefined,
  message: string | undefined,
  fallback: string,
): string {
  const localizedMessage = code ? apiErrorMessages[code] : undefined;
  return localizedMessage ?? fallback;
}

const apiErrorMessages: Record<string, string> = {
  AUTH_INVALID_CREDENTIALS: 'Email hoặc mật khẩu không đúng.',
  AUTH_REQUIRED: 'Vui lòng đăng nhập để tiếp tục.',
  AUTH_SESSION_INVALID:
    'Phiên đăng nhập đã hết hạn hoặc không còn hợp lệ. Vui lòng đăng nhập lại.',
  AUTH_TOKEN_INVALID:
    'Phiên đăng nhập không còn hợp lệ. Vui lòng đăng nhập lại.',
  AUTH_ORIGIN_FORBIDDEN: 'Nguồn truy cập hiện tại chưa được cho phép.',
  ACTIVE_TRIP_EXISTS: 'Bạn đang có một chuyến xe đang hoạt động.',
  DRIVER_LOCATION_RATE_LIMITED:
    'Vị trí được cập nhật quá thường xuyên. Vui lòng thử lại sau ít giây.',
  DRIVER_LOCATION_SIMULATOR_DISABLED:
    'Môi trường này không cho phép gửi vị trí mô phỏng.',
  DRIVER_NOT_ELIGIBLE:
    'Tài khoản Tài xế chưa đủ điều kiện để bật trạng thái nhận chuyến.',
  DRIVER_WORK_STATE_CONFLICT:
    'Tài xế đang bận một chuyến xe hoặc đơn giao hàng khác.',
  DELIVERY_NOT_ASSIGNED_TO_DRIVER:
    'Đơn giao này không được phân công cho Tài xế hiện tại.',
  DELIVERY_INVALID_STATE: 'Đơn giao hàng chưa thể thực hiện thao tác này.',
  DELIVERY_NOT_FOUND: 'Không tìm thấy đơn giao hàng.',
  DELIVERY_NOT_MATCHABLE: 'Đơn giao hàng hiện chưa thể tìm Tài xế.',
  EMAIL_ALREADY_REGISTERED: 'Email này đã được đăng ký.',
  FARE_QUOTE_EXPIRED: 'Báo giá đã hết hạn. Vui lòng lấy báo giá mới.',
  IDEMPOTENCY_KEY_REUSED:
    'Yêu cầu đã được gửi trước đó với dữ liệu khác. Vui lòng thử lại.',
  OFFER_ALREADY_RESOLVED: 'Lời mời này đã được xử lý.',
  OFFER_EXPIRED: 'Lời mời đã hết hạn.',
  OFFER_NOT_FOUND: 'Không tìm thấy lời mời hiện tại.',
  OFFER_NOT_FOR_DRIVER: 'Lời mời này không dành cho Tài xế hiện tại.',
  OUTSIDE_SERVICE_AREA: 'Địa điểm hiện nằm ngoài khu vực phục vụ thử nghiệm.',
  PAYMENT_ALREADY_SUCCEEDED: 'Khoản thanh toán này đã được hoàn tất.',
  PAYMENT_FORBIDDEN: 'Bạn không có quyền xem hoặc thực hiện thanh toán này.',
  PAYMENT_PENDING: 'Thanh toán đang được xử lý.',
  PAYMENT_RECONCILIATION_REQUIRED:
    'Thanh toán cần được đối soát trước khi tiếp tục.',
  RATE_LIMITED: 'Bạn thao tác quá nhanh. Vui lòng thử lại sau ít giây.',
  RIDE_POINTS_IDENTICAL: 'Điểm đón và điểm đến phải khác nhau.',
  ROUTING_UNAVAILABLE:
    'Dịch vụ tuyến đường tạm thời chưa khả dụng; đang dùng ước tính tọa độ.',
  SERVICE_TYPE_UNAVAILABLE: 'Loại dịch vụ đã chọn hiện chưa khả dụng.',
  TRIP_CANCELLATION_NOT_ALLOWED:
    'Chuyến xe không thể hủy ở trạng thái hiện tại.',
  TRIP_INVALID_STATE: 'Chuyến xe chưa thể thực hiện thao tác này.',
  TRIP_NOT_COMPLETED: 'Chuyến xe chưa hoàn tất nên chưa thể thanh toán.',
  TRIP_NOT_FOUND: 'Không tìm thấy chuyến xe.',
  TRIP_NOT_MATCHABLE: 'Chuyến xe hiện chưa thể tìm Tài xế.',
  VALIDATION_FAILED: 'Thông tin gửi lên chưa hợp lệ. Vui lòng kiểm tra lại.',
};

let authBootstrapPromise: Promise<AuthenticationResponse | null> | null = null;

function bootstrapAuthentication(): Promise<AuthenticationResponse | null> {
  if (!authBootstrapPromise) {
    authBootstrapPromise = request<AuthenticationResponse>('/auth/refresh', {
      method: 'POST',
    }).catch(() => null);
  }
  return authBootstrapPromise;
}

export function App() {
  const [api, setApi] = useState<ApiState>({ status: 'checking' });
  const [page, setPage] = useState<Page>(pageFromLocation);
  const [actor, setActor] = useState<AuthenticatedActor | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [authBootstrap, setAuthBootstrap] =
    useState<AuthBootstrapState>('checking');
  const pageFocusRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/v1/health/ready', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('API is not ready');
        return (await response.json()) as ReadinessResponse;
      })
      .then((details) => setApi({ status: 'ready', details }))
      .catch((error: unknown) => {
        if ((error as Error).name !== 'AbortError') {
          setApi({ status: 'unavailable' });
        }
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    let disposed = false;
    bootstrapAuthentication()
      .then((result) => {
        if (disposed || !result) return;
        setAccessToken(result.accessToken);
        setActor(result.actor);
      })
      .finally(() => {
        if (!disposed) setAuthBootstrap('ready');
      });

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    const onPopState = () => setPage(pageFromLocation());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    pageFocusRef.current?.focus();
  }, [page]);

  useEffect(() => {
    const pageTitles: Record<Page, string> = {
      home: 'Di chuyển rõ ràng',
      register: 'Tạo tài khoản',
      'sign-in': 'Đăng nhập',
      account: 'Tài khoản',
      'driver-setup': 'Khai báo Tài xế',
      'driver-console': 'Bảng điều khiển Tài xế',
      'ride-request': 'Đặt chuyến',
      'delivery-request': 'Gửi hàng',
    };
    document.title = `Gove — ${pageTitles[page]}`;
  }, [page]);

  const navigate = (next: Page) => {
    const path: Record<Page, string> = {
      home: '/',
      register: '/register',
      'sign-in': '/sign-in',
      account: '/account',
      'driver-setup': '/driver/setup',
      'driver-console': '/driver/console',
      'ride-request': '/ride/request',
      'delivery-request': '/delivery/request',
    };
    window.history.pushState({}, '', path[next]);
    setPage(next);
    window.scrollTo({ top: 0 });
  };

  const completeAuthentication = (result: AuthenticationResponse) => {
    setAccessToken(result.accessToken);
    setActor(result.actor);
    navigate(
      result.actor.roles.includes('DRIVER') ? 'driver-setup' : 'account',
    );
  };

  const signOut = async () => {
    try {
      await request<void>('/auth/logout', { method: 'POST' });
    } finally {
      setActor(null);
      setAccessToken(null);
      navigate('home');
    }
  };

  const apiLabel =
    api.status === 'checking'
      ? 'Đang kiểm tra hệ thống'
      : api.status === 'ready'
        ? 'Hệ thống đang hoạt động'
        : 'Hệ thống chưa sẵn sàng';

  const requiresSession = !['home', 'register', 'sign-in'].includes(page);

  if (requiresSession && authBootstrap === 'checking') {
    return (
      <main
        id="main-content"
        className="account-shell"
        ref={pageFocusRef}
        tabIndex={-1}
      >
        <AppHeader
          api={api}
          apiLabel={apiLabel}
          actor={null}
          onHome={() => navigate('home')}
          onSignOut={() => undefined}
        />
        <section className="access-required" aria-live="polite">
          <p className="eyebrow">Phiên đăng nhập</p>
          <h1>Đang khôi phục phiên làm việc.</h1>
          <p>
            Gove đang kiểm tra phiên bảo mật hiện có. Bạn sẽ được đưa vào đúng
            màn hình sau khi hoàn tất.
          </p>
        </section>
      </main>
    );
  }

  if (page !== 'home') {
    return (
      <main
        id="main-content"
        className="account-shell"
        ref={pageFocusRef}
        tabIndex={-1}
      >
        <AppHeader
          api={api}
          apiLabel={apiLabel}
          actor={actor}
          onHome={() => navigate('home')}
          onSignOut={signOut}
        />
        {page === 'register' ? (
          <RegisterPage
            onRegistered={() => navigate('sign-in')}
            onSignIn={() => navigate('sign-in')}
          />
        ) : null}
        {page === 'sign-in' ? (
          <SignInPage
            onAuthenticated={completeAuthentication}
            onRegister={() => navigate('register')}
          />
        ) : null}
        {page === 'account' ? (
          <AccountPage
            actor={actor}
            accessToken={accessToken}
            onSignIn={() => navigate('sign-in')}
            onDriverSetup={() => navigate('driver-setup')}
            onDriverConsole={() => navigate('driver-console')}
            onRideRequest={() => navigate('ride-request')}
            onDeliveryRequest={() => navigate('delivery-request')}
          />
        ) : null}
        {page === 'ride-request' ? (
          <RideRequestPage
            actor={actor}
            accessToken={accessToken}
            onSignIn={() => navigate('sign-in')}
            onAccount={() => navigate('account')}
          />
        ) : null}
        {page === 'delivery-request' ? (
          <DeliveryRequestPage
            actor={actor}
            accessToken={accessToken}
            onSignIn={() => navigate('sign-in')}
            onAccount={() => navigate('account')}
          />
        ) : null}
        {page === 'driver-setup' ? (
          <DriverSetupPage
            actor={actor}
            accessToken={accessToken}
            onSignIn={() => navigate('sign-in')}
            onAccount={() => navigate('account')}
          />
        ) : null}
        {page === 'driver-console' ? (
          <DriverConsolePage
            actor={actor}
            accessToken={accessToken}
            onSignIn={() => navigate('sign-in')}
            onAccount={() => navigate('account')}
          />
        ) : null}
      </main>
    );
  }

  return (
    <main ref={pageFocusRef} id="main-content" tabIndex={-1}>
      <AppHeader
        api={api}
        apiLabel={apiLabel}
        actor={actor}
        onHome={() => navigate('home')}
        onSignOut={signOut}
      />
      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">Di chuyển đô thị theo thời gian thực</p>
          <h1>Mỗi chuyến đi, rõ ràng từ lúc đặt đến khi hoàn tất.</h1>
          <p className="hero-description">
            Gove kết nối khách hàng, tài xế và đội ngũ điều hành trong một quy
            trình dễ hiểu, với trạng thái trực tiếp cho biết chính xác điều gì
            đang diễn ra.
          </p>
          <div className="hero-actions">
            <button
              className="primary-link"
              type="button"
              onClick={() => navigate(actor ? 'account' : 'register')}
            >
              {actor ? 'Mở tài khoản' : 'Tạo tài khoản'}
              <ArrowRight aria-hidden="true" size={20} weight="bold" />
            </button>
            {!actor ? (
              <button
                className="secondary-link"
                type="button"
                onClick={() => navigate('sign-in')}
              >
                <UserCircle aria-hidden="true" size={19} weight="duotone" />
                Đăng nhập
              </button>
            ) : null}
          </div>
        </div>
        <div
          className="route-card"
          role="group"
          aria-labelledby="hero-route-heading"
        >
          <div className="route-map" aria-hidden="true">
            <span className="route-line" />
            <span className="route-point route-point--pickup" />
            <span className="route-point route-point--dropoff" />
            <span className="vehicle-marker">
              <CarProfile size={28} weight="fill" />
            </span>
          </div>
          <div className="route-summary">
            <div>
              <span className="summary-label">Hành trình mẫu</span>
              <strong id="hero-route-heading">Một chuyến đi trọn vẹn</strong>
            </div>
            <span className="planned-badge">Đang xây dựng</span>
          </div>
        </div>
      </section>
      <section className="roles" aria-labelledby="roles-heading">
        <div className="section-heading">
          <p className="eyebrow">Thiết kế theo nhu cầu thực tế</p>
          <h2 id="roles-heading">Một nền tảng, ba góc nhìn rõ ràng</h2>
        </div>
        <div className="role-grid">
          {roles.map(({ icon: Icon, label, description }) => (
            <article className="role-card" key={label}>
              <span className="icon-tile" aria-hidden="true">
                <Icon size={26} weight="duotone" />
              </span>
              <h3>{label}</h3>
              <p>{description}</p>
              <span className="role-state">
                {label === 'Tài xế'
                  ? 'Có thể khai báo hồ sơ'
                  : label === 'Khách hàng'
                    ? 'Có thể đặt chuyến và gửi hàng'
                    : 'Đang hoàn thiện theo phạm vi MVP'}
              </span>
            </article>
          ))}
        </div>
      </section>
      <section className="journey" aria-labelledby="journey-heading">
        <div className="section-heading section-heading--light">
          <p className="eyebrow">Luồng MVP đầu tiên</p>
          <h2 id="journey-heading">Mỗi bước đều có trạng thái rõ ràng</h2>
        </div>
        <ol className="journey-list">
          {[
            [
              '01',
              'Đặt chuyến',
              'Khách hàng xác nhận điểm đi, điểm đến và giá ước tính.',
            ],
            ['02', 'Tìm tài xế', 'Hệ thống giữ chỗ một tài xế phù hợp ở gần.'],
            [
              '03',
              'Di chuyển',
              'Khách hàng và tài xế cùng nhận trạng thái trực tiếp.',
            ],
            [
              '04',
              'Thanh toán',
              'Chuyến đi kết thúc bằng thanh toán mô phỏng.',
            ],
          ].map(([number, title, description]) => (
            <li key={number}>
              <span className="journey-number">{number}</span>
              <div>
                <h3>{title}</h3>
                <p>{description}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
      <section className="platform-status" aria-labelledby="status-heading">
        <div>
          <p className="eyebrow">Trạng thái hệ thống</p>
          <h2 id="status-heading">Có thể kiểm tra ngay tại máy local</h2>
          <p className="status-copy">
            Bảng này đọc readiness endpoint của API và chỉ báo thành công sau
            khi PostgreSQL và PostGIS trả lời được truy vấn thực tế.
          </p>
        </div>
        <div
          className={`health-card health-card--${api.status}`}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {api.status === 'ready' ? (
            <CheckCircle aria-hidden="true" size={34} weight="fill" />
          ) : api.status === 'unavailable' ? (
            <ShieldCheck aria-hidden="true" size={34} weight="duotone" />
          ) : (
            <MapPin aria-hidden="true" size={34} weight="duotone" />
          )}
          <div>
            <strong>{apiLabel}</strong>
            <span>
              {api.status === 'ready'
                ? `PostGIS ${api.details.dependencies.postgis}`
                : api.status === 'checking'
                  ? 'Đang chờ API xác nhận trạng thái sẵn sàng'
                  : 'Hãy khởi động API và database local để kết nối'}
            </span>
          </div>
        </div>
      </section>
      <footer>
        <span>Gove</span>
        <span>
          Thiết kế cho trải nghiệm di chuyển đáng tin cậy và có thể đo lường.
        </span>
      </footer>
    </main>
  );
}

function AppHeader({
  api,
  apiLabel,
  actor,
  onHome,
  onSignOut,
}: {
  api: ApiState;
  apiLabel: string;
  actor: AuthenticatedActor | null;
  onHome: () => void;
  onSignOut: () => void;
}) {
  const compactApiLabel =
    api.status === 'checking'
      ? 'Đang kiểm tra'
      : api.status === 'ready'
        ? 'Sẵn sàng'
        : 'Chưa sẵn sàng';

  return (
    <header className="topbar">
      <button
        className="brand"
        type="button"
        onClick={onHome}
        aria-label="Về trang chủ Gove"
      >
        <span className="brand-mark" aria-hidden="true">
          <img src="/assets/gove-mark.svg" alt="" />
        </span>
        <span>Gove</span>
      </button>
      <div className="header-actions">
        <span
          className="status-link"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          aria-label={apiLabel}
          title={apiLabel}
        >
          <span
            className={`status-dot status-dot--${api.status}`}
            aria-hidden="true"
          />
          <span className="status-label-full">{apiLabel}</span>
          <span className="status-label-compact" aria-hidden="true">
            {compactApiLabel}
          </span>
        </span>
        {actor ? (
          <button
            className="text-button"
            type="button"
            onClick={onSignOut}
            aria-label="Đăng xuất"
            title="Đăng xuất"
          >
            <SignOut aria-hidden="true" size={18} />
            Đăng xuất
          </button>
        ) : null}
      </div>
    </header>
  );
}

function RegisterPage({
  onRegistered,
  onSignIn,
}: {
  onRegistered: () => void;
  onSignIn: () => void;
}) {
  const [state, setState] = useState<RequestState>({ state: 'idle' });
  const idempotencyKey = useRef(crypto.randomUUID());

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setState({ state: 'submitting' });
    const data = new FormData(event.currentTarget);
    try {
      await request<RegistrationResponse>('/auth/register', {
        method: 'POST',
        headers: { 'idempotency-key': idempotencyKey.current },
        body: JSON.stringify({
          displayName: data.get('displayName'),
          email: data.get('email'),
          password: data.get('password'),
          requestedRole: data.get('role'),
        }),
      });
      onRegistered();
    } catch (error) {
      setState({ state: 'error', message: (error as Error).message });
    }
  };

  return (
    <section className="auth-layout">
      <div className="auth-intro">
        <p className="eyebrow">Tài khoản Gove</p>
        <h1>Tạo tài khoản Gove.</h1>
        <p>
          Chọn Khách hàng để đặt chuyến, hoặc Tài xế để khai báo hồ sơ và phương
          tiện. Tài khoản Tài xế chỉ được nhận việc sau khi được duyệt.
        </p>
      </div>
      <form
        className="auth-card"
        onSubmit={submit}
        aria-busy={state.state === 'submitting'}
      >
        <FormHeading
          title="Tạo tài khoản"
          subtitle="Dùng email bạn đang sử dụng."
        />
        <label htmlFor="displayName">Họ và tên</label>
        <input
          autoComplete="name"
          id="displayName"
          name="displayName"
          required
          maxLength={120}
        />
        <label htmlFor="email">Địa chỉ email</label>
        <input
          autoComplete="email"
          id="email"
          name="email"
          type="email"
          required
        />
        <label htmlFor="password">Mật khẩu</label>
        <input
          autoComplete="new-password"
          id="password"
          name="password"
          type="password"
          minLength={12}
          required
          aria-describedby="password-hint"
        />
        <small id="password-hint">
          Tối thiểu 12 ký tự. Có thể dùng trình quản lý mật khẩu và dán mật
          khẩu.
        </small>
        <fieldset>
          <legend>Loại tài khoản</legend>
          <div className="choice-row">
            <label>
              <input defaultChecked name="role" type="radio" value="CUSTOMER" />{' '}
              Khách hàng
            </label>
            <label>
              <input name="role" type="radio" value="DRIVER" /> Tài xế
            </label>
          </div>
        </fieldset>
        <SubmitState state={state} label="Tạo tài khoản" />
        <p className="form-footer">
          Đã có tài khoản?{' '}
          <button type="button" className="inline-button" onClick={onSignIn}>
            Đăng nhập
          </button>
        </p>
      </form>
    </section>
  );
}

function SignInPage({
  onAuthenticated,
  onRegister,
}: {
  onAuthenticated: (result: AuthenticationResponse) => void;
  onRegister: () => void;
}) {
  const [state, setState] = useState<RequestState>({ state: 'idle' });
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setState({ state: 'submitting' });
    const data = new FormData(event.currentTarget);
    try {
      onAuthenticated(
        await request<AuthenticationResponse>('/auth/login', {
          method: 'POST',
          body: JSON.stringify({
            email: data.get('email'),
            password: data.get('password'),
          }),
        }),
      );
    } catch (error) {
      setState({ state: 'error', message: (error as Error).message });
    }
  };

  return (
    <section className="auth-layout">
      <div className="auth-intro">
        <p className="eyebrow">Chào mừng trở lại</p>
        <h1>Tiếp tục với phiên đăng nhập bảo mật.</h1>
        <p>
          Refresh token được lưu trong HttpOnly cookie. Access token ngắn hạn
          chỉ được giữ trong bộ nhớ của trang.
        </p>
      </div>
      <form
        className="auth-card"
        onSubmit={submit}
        aria-busy={state.state === 'submitting'}
      >
        <FormHeading
          title="Đăng nhập"
          subtitle="Nhập thông tin tài khoản bạn đã đăng ký."
        />
        <label htmlFor="login-email">Địa chỉ email</label>
        <input
          autoComplete="email"
          id="login-email"
          name="email"
          type="email"
          required
        />
        <label htmlFor="login-password">Mật khẩu</label>
        <input
          autoComplete="current-password"
          id="login-password"
          name="password"
          type="password"
          required
        />
        <SubmitState state={state} label="Đăng nhập" />
        <p className="form-footer">
          Chưa có tài khoản?{' '}
          <button type="button" className="inline-button" onClick={onRegister}>
            Tạo tài khoản
          </button>
        </p>
      </form>
    </section>
  );
}

function AccountPage({
  actor,
  accessToken,
  onSignIn,
  onDriverSetup,
  onDriverConsole,
  onRideRequest,
  onDeliveryRequest,
}: {
  actor: AuthenticatedActor | null;
  accessToken: string | null;
  onSignIn: () => void;
  onDriverSetup: () => void;
  onDriverConsole: () => void;
  onRideRequest: () => void;
  onDeliveryRequest: () => void;
}) {
  if (!actor) return <AccessRequired onSignIn={onSignIn} />;
  return (
    <section className="account-layout">
      <div className="account-heading">
        <p className="eyebrow">Tài khoản đã đăng nhập</p>
        <h1>Xin chào, {actor.displayName}.</h1>
        <p>
          Chọn dịch vụ bạn cần. Gove sẽ hiển thị giá, tài xế và trạng thái xử lý
          theo từng bước.
        </p>
      </div>
      <article className="account-card">
        <dl>
          <div>
            <dt>Email</dt>
            <dd>{actor.email}</dd>
          </div>
          <div>
            <dt>Vai trò</dt>
            <dd>{actor.roles.map(displayRole).join(', ')}</dd>
          </div>
        </dl>
        {actor.roles.includes('DRIVER') ? (
          <div className="account-action-stack">
            <button
              className="primary-link"
              type="button"
              onClick={onDriverConsole}
            >
              Mở bảng điều khiển Tài xế{' '}
              <ArrowRight aria-hidden="true" size={20} weight="bold" />
            </button>
            <button
              className="secondary-link"
              type="button"
              onClick={onDriverSetup}
            >
              Cập nhật hồ sơ Tài xế
            </button>
          </div>
        ) : actor.roles.includes('CUSTOMER') ? (
          <div className="account-action-stack">
            <div
              className="service-choice-grid"
              role="group"
              aria-label="Chọn dịch vụ"
            >
              <button
                className="service-choice-card service-choice-card--ride"
                type="button"
                onClick={onRideRequest}
              >
                <span className="service-choice-card__icon" aria-hidden="true">
                  <Motorcycle size={28} weight="fill" />
                </span>
                <span>
                  <strong>Đặt chuyến</strong>
                  <small>Chọn điểm đi, điểm đến và xem giá ước tính.</small>
                </span>
                <ArrowRight aria-hidden="true" size={20} weight="bold" />
              </button>
              <button
                className="service-choice-card service-choice-card--delivery"
                type="button"
                onClick={onDeliveryRequest}
              >
                <span className="service-choice-card__icon" aria-hidden="true">
                  <Package size={28} weight="fill" />
                </span>
                <span>
                  <strong>Gửi hàng</strong>
                  <small>
                    Tạo đơn giao một kiện hàng với người nhận rõ ràng.
                  </small>
                </span>
                <ArrowRight aria-hidden="true" size={20} weight="bold" />
              </button>
            </div>
            <p className="notice">
              Đây là môi trường demo local; các điểm đón/trả dùng khu vực mô
              phỏng.
            </p>
          </div>
        ) : (
          <p className="notice">Vai trò này chưa có thao tác đặt chuyến.</p>
        )}
      </article>
      {accessToken &&
      (actor.roles.includes('CUSTOMER') || actor.roles.includes('DRIVER')) ? (
        <HistoryPanel accessToken={accessToken} />
      ) : null}
      {accessToken && actor.roles.includes('CUSTOMER') ? (
        <DeliveryHistoryPanel accessToken={accessToken} />
      ) : null}
    </section>
  );
}

function HistoryPanel({ accessToken }: { accessToken: string }) {
  const [items, setItems] = useState<TripHistoryItem[]>([]);
  const [state, setState] = useState<RequestState>({ state: 'submitting' });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let active = true;
    request<TripHistoryItem[]>('/trips/history', {
      headers: { authorization: `Bearer ${accessToken}` },
    })
      .then((result) => {
        if (!active) return;
        setItems(result);
        setState((current) =>
          current.state === 'submitting' ? { state: 'idle' } : current,
        );
      })
      .catch((error: unknown) => {
        if (active)
          setState({ state: 'error', message: (error as Error).message });
      });
    return () => {
      active = false;
    };
  }, [accessToken, reloadToken]);

  return (
    <article
      className="account-card history-card"
      aria-labelledby="history-heading"
    >
      <div className="form-heading">
        <h2 id="history-heading">Lịch sử chuyến đi</h2>
        <p>Các chuyến đã hoàn tất hoặc kết thúc của tài khoản này.</p>
      </div>
      {state.state === 'submitting' ? (
        <p className="notice" role="status">
          Đang tải lịch sử chuyến đi…
        </p>
      ) : null}
      {state.state === 'error' ? (
        <div className="feedback-stack">
          <p className="form-error" role="alert">
            {state.message}
          </p>
          <button
            className="secondary-link feedback-action"
            type="button"
            onClick={() => {
              setState({ state: 'submitting' });
              setReloadToken((current) => current + 1);
            }}
          >
            Thử tải lại lịch sử
          </button>
        </div>
      ) : null}
      {state.state === 'idle' && items.length === 0 ? (
        <p className="notice">Chưa có chuyến đi nào.</p>
      ) : null}
      {items.length ? (
        <div className="history-list">
          {items.map((item) => (
            <div className="history-row" key={item.id}>
              <div>
                <strong>{displayTripState(item.state)}</strong>
                <span>{new Date(item.createdAt).toLocaleString('vi-VN')}</span>
              </div>
              <div>
                <strong>
                  {formatFare(
                    item.finalFareMinor ?? item.quotedTotalFareMinor,
                    item.currency,
                  )}
                </strong>
                <span>
                  {item.paymentStatus
                    ? `Thanh toán: ${displayPaymentStatus(item.paymentStatus)}`
                    : 'Chưa ghi nhận thanh toán'}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function DeliveryHistoryPanel({ accessToken }: { accessToken: string }) {
  const [items, setItems] = useState<DeliveryResponse[]>([]);
  const [selected, setSelected] = useState<DeliveryResponse | null>(null);
  const [state, setState] = useState<RequestState>({ state: 'submitting' });
  const [detailState, setDetailState] = useState<RequestState>({
    state: 'idle',
  });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let active = true;
    request<DeliveryResponse[]>('/deliveries', {
      headers: { authorization: `Bearer ${accessToken}` },
    })
      .then((result) => {
        if (!active) return;
        setItems(result);
        setState({ state: 'idle' });
      })
      .catch((error: unknown) => {
        if (active)
          setState({ state: 'error', message: (error as Error).message });
      });
    return () => {
      active = false;
    };
  }, [accessToken, reloadToken]);

  const selectDelivery = async (deliveryId: string) => {
    setDetailState({ state: 'submitting' });
    try {
      const result = await request<DeliveryResponse>(
        `/deliveries/${deliveryId}`,
        {
          headers: { authorization: `Bearer ${accessToken}` },
        },
      );
      setSelected(result);
      setDetailState({ state: 'idle' });
    } catch (error) {
      setDetailState({ state: 'error', message: (error as Error).message });
    }
  };

  return (
    <article
      className="account-card history-card delivery-history-card"
      aria-labelledby="delivery-history-heading"
    >
      <div className="form-heading">
        <h2 id="delivery-history-heading">Lịch sử gửi hàng</h2>
        <p>Các đơn hàng của tài khoản, đơn mới nhất ở trên.</p>
      </div>
      {state.state === 'submitting' ? (
        <p className="notice" role="status">
          Đang tải lịch sử gửi hàng…
        </p>
      ) : null}
      {state.state === 'error' ? (
        <div className="feedback-stack">
          <p className="form-error" role="alert">
            {state.message}
          </p>
          <button
            className="secondary-link feedback-action"
            type="button"
            onClick={() => {
              setState({ state: 'submitting' });
              setReloadToken((current) => current + 1);
            }}
          >
            Thử tải lại lịch sử gửi hàng
          </button>
        </div>
      ) : null}
      {state.state === 'idle' && items.length === 0 ? (
        <p className="notice">Chưa có đơn gửi hàng nào.</p>
      ) : null}
      {items.length ? (
        <div className="history-list" role="list" aria-label="Lịch sử gửi hàng">
          {items.map((item) => (
            <button
              className="history-row delivery-history-row"
              type="button"
              key={item.id}
              onClick={() => void selectDelivery(item.id)}
              aria-pressed={selected?.id === item.id}
            >
              <span className="history-row-copy">
                <strong>{displayDeliveryState(item.state)}</strong>
                <span>{item.parcelDescription}</span>
              </span>
              <span className="history-row-copy history-row-meta">
                <strong>{item.dropoff.label}</strong>
                <span>{new Date(item.createdAt).toLocaleString('vi-VN')}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {detailState.state === 'submitting' ? (
        <p className="notice delivery-detail-loading" role="status">
          Đang tải trạng thái đơn hàng…
        </p>
      ) : null}
      {detailState.state === 'error' ? (
        <p className="form-error" role="alert">
          {detailState.message}
        </p>
      ) : null}
      {selected && detailState.state === 'idle' ? (
        <section
          className="delivery-detail"
          aria-live="polite"
          aria-labelledby="delivery-detail-heading"
        >
          <div className="delivery-detail-heading">
            <div>
              <p className="eyebrow">Trạng thái đơn hàng</p>
              <h3 id="delivery-detail-heading">
                {displayDeliveryState(selected.state)}
              </h3>
            </div>
            <span className="driver-state-pill">v{selected.version}</span>
          </div>
          <dl className="quote-details">
            <div>
              <dt>Điểm lấy hàng</dt>
              <dd>{selected.pickup.label}</dd>
            </div>
            <div>
              <dt>Điểm giao hàng</dt>
              <dd>{selected.dropoff.label}</dd>
            </div>
            <div>
              <dt>Người nhận</dt>
              <dd>{selected.recipientDisplayName}</dd>
            </div>
            <div>
              <dt>Kiện hàng</dt>
              <dd>{selected.parcelDescription}</dd>
            </div>
            <div>
              <dt>Khối lượng khai báo</dt>
              <dd>{formatWeight(selected.declaredWeightGrams)}</dd>
            </div>
          </dl>
        </section>
      ) : null}
    </article>
  );
}

function DriverConsolePage({
  actor,
  accessToken,
  onSignIn,
  onAccount,
}: {
  actor: AuthenticatedActor | null;
  accessToken: string | null;
  onSignIn: () => void;
  onAccount: () => void;
}) {
  const [offers, setOffers] = useState<TripOfferResponse[]>([]);
  const [current, setCurrent] = useState<ActiveTripResponse | null>(null);
  const [deliveryOffers, setDeliveryOffers] = useState<DeliveryOfferResponse[]>(
    [],
  );
  const [currentDelivery, setCurrentDelivery] =
    useState<DeliveryResponse | null>(null);
  const [custodyConfirmation, setCustodyConfirmation] = useState('');
  const [recipientProof, setRecipientProof] = useState('');
  const [workState, setWorkState] = useState<DriverWorkState>('OFFLINE');
  const [state, setState] = useState<RequestState>({ state: 'submitting' });
  const [commandError, setCommandError] = useState<string | null>(null);
  const [refreshAttempt, setRefreshAttempt] = useState(0);
  const [driverLocation, setDriverLocation] =
    useState<DriverLocationSnapshot | null>(null);
  const [locationState, setLocationState] = useState<
    | 'idle'
    | 'requesting'
    | 'sending'
    | 'sent'
    | 'denied'
    | 'unsupported'
    | 'error'
  >('idle');
  const [locationSharingEnabled, setLocationSharingEnabled] = useState(false);
  const locationSequenceRef = useRef(Math.floor(Date.now() / 1000));
  const lastLocationSentAtRef = useRef(0);
  const refreshSequenceRef = useRef(0);
  const commandInFlightRef = useRef(0);

  useEffect(() => {
    if (!accessToken || !actor?.roles.includes('DRIVER')) return;
    let active = true;
    const refresh = async () => {
      const refreshSequence = ++refreshSequenceRef.current;
      setState((current) =>
        current.state === 'error' ? { state: 'submitting' } : current,
      );
      try {
        const [
          nextOffers,
          nextCurrent,
          nextDeliveryOffers,
          nextDelivery,
          nextWorkState,
        ] = await Promise.all([
          request<TripOfferResponse[]>('/dispatch/offers/me', {
            headers: { authorization: `Bearer ${accessToken}` },
          }),
          request<ActiveTripResponse | null>('/dispatch/trips/current', {
            headers: { authorization: `Bearer ${accessToken}` },
          }),
          request<DeliveryOfferResponse[]>('/delivery-offers/me', {
            headers: { authorization: `Bearer ${accessToken}` },
          }),
          request<DeliveryResponse | null>('/delivery-assignments/current', {
            headers: { authorization: `Bearer ${accessToken}` },
          }),
          request<{ state: DriverWorkState }>('/drivers/me/work-state', {
            headers: { authorization: `Bearer ${accessToken}` },
          }),
        ]);
        if (!active || refreshSequence !== refreshSequenceRef.current) return;
        setOffers(nextOffers);
        setCurrent(nextCurrent);
        setDeliveryOffers(nextDeliveryOffers);
        setCurrentDelivery(nextDelivery);
        setWorkState(nextWorkState.state);
        setCommandError(null);
        setState((current) =>
          current.state === 'submitting' && commandInFlightRef.current === 0
            ? { state: 'idle' }
            : current,
        );
      } catch (error) {
        if (active)
          setState({ state: 'error', message: (error as Error).message });
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 3000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [accessToken, actor, refreshAttempt]);

  useEffect(() => {
    setCustodyConfirmation('');
    setRecipientProof('');
  }, [currentDelivery?.id]);

  useEffect(() => {
    const hasActiveWork = Boolean(current?.id || currentDelivery?.id);
    if (!accessToken || !actor?.roles.includes('DRIVER') || !hasActiveWork) {
      setLocationSharingEnabled(false);
      setLocationState('idle');
      setDriverLocation(null);
      return;
    }
    if (!locationSharingEnabled) {
      setLocationState('idle');
      setDriverLocation(null);
      return;
    }
    if (!('geolocation' in navigator)) {
      setLocationState('unsupported');
      return;
    }

    let disposed = false;
    setLocationState('requesting');
    const sendLocation = (position: GeolocationPosition) => {
      if (disposed) return;
      const now = Date.now();
      const capturedAt = new Date(
        position.timestamp > 0 ? position.timestamp : now,
      ).toISOString();
      const snapshot: DriverLocationSnapshot = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracyMeters: Math.max(0, position.coords.accuracy),
        capturedAt,
        receivedAt: new Date(now).toISOString(),
      };
      setDriverLocation(snapshot);
      if (now - lastLocationSentAtRef.current < 2_800) return;
      lastLocationSentAtRef.current = now;
      locationSequenceRef.current += 1;
      setLocationState('sending');
      void request('/drivers/me/location', {
        method: 'PUT',
        headers: { authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          latitude: snapshot.latitude,
          longitude: snapshot.longitude,
          accuracyMeters: snapshot.accuracyMeters,
          speedMetersPerSecond:
            position.coords.speed !== null && position.coords.speed >= 0
              ? position.coords.speed
              : null,
          headingDegrees:
            position.coords.heading !== null && position.coords.heading >= 0
              ? position.coords.heading
              : null,
          capturedAt: snapshot.capturedAt,
          source: 'GPS',
          sequenceNumber: locationSequenceRef.current,
        }),
      })
        .then(() => {
          if (!disposed) setLocationState('sent');
        })
        .catch(() => {
          if (!disposed) setLocationState('error');
        });
    };
    const watchId = navigator.geolocation.watchPosition(
      sendLocation,
      (error) => {
        if (disposed) return;
        setLocationState(error.code === 1 ? 'denied' : 'error');
      },
      { enableHighAccuracy: true, maximumAge: 2_000, timeout: 10_000 },
    );
    return () => {
      disposed = true;
      navigator.geolocation.clearWatch(watchId);
    };
  }, [
    accessToken,
    actor?.id,
    current?.id,
    currentDelivery?.id,
    locationSharingEnabled,
  ]);

  if (!actor || !accessToken || !actor.roles.includes('DRIVER')) {
    return <AccessRequired onSignIn={onSignIn} />;
  }

  const command = async (
    path: string,
    options: RequestInit = {},
  ): Promise<void> => {
    commandInFlightRef.current += 1;
    setState({ state: 'submitting' });
    setCommandError(null);
    try {
      await request(path, {
        ...options,
        headers: {
          authorization: `Bearer ${accessToken}`,
          'idempotency-key': crypto.randomUUID(),
          ...options.headers,
        },
      });
      setRefreshAttempt((current) => current + 1);
    } catch (error) {
      const message = (error as Error).message;
      setCommandError(message);
      setState({ state: 'error', message });
    } finally {
      commandInFlightRef.current -= 1;
    }
  };

  const toggleAvailability = () => {
    const next = workState === 'OFFLINE' ? 'AVAILABLE' : 'OFFLINE';
    void command('/drivers/me/work-state', {
      method: 'PUT',
      body: JSON.stringify({ state: next }),
    });
  };

  const acceptOffer = (offerId: string) => {
    void command(`/dispatch/offers/${offerId}/accept`, { method: 'POST' });
  };

  const acceptDeliveryOffer = (offerId: string) => {
    void command(`/delivery-offers/${offerId}/accept`, { method: 'POST' });
  };

  const transitionDelivery = (action: 'arrive' | 'pickup' | 'complete') => {
    if (!currentDelivery) return;
    void command(`/deliveries/${currentDelivery.id}/${action}`, {
      method: 'POST',
      ...(action === 'pickup'
        ? {
            body: JSON.stringify({
              custodyConfirmation,
            }),
          }
        : action === 'complete'
          ? {
              body: JSON.stringify({
                recipientProof,
              }),
            }
          : {}),
    });
  };

  const transition = (action: 'arrive' | 'start' | 'complete') => {
    if (!current) return;
    void command(`/dispatch/trips/${current.id}/${action}`, {
      method: 'POST',
      ...(action === 'complete'
        ? {
            body: JSON.stringify({
              actualDistanceMeters: 2500,
              actualDurationSeconds: 420,
            }),
          }
        : {}),
    });
  };

  return (
    <section className="account-layout driver-console-layout">
      <div className="account-heading">
        <p className="eyebrow">Khu vực Tài xế</p>
        <h1>Điều phối chuyến được giao.</h1>
        <p>
          Bảng điều khiển đồng bộ với API mỗi 3 giây. Đây chưa phải tính năng
          theo dõi GPS nền.
        </p>
        <button className="back-link" type="button" onClick={onAccount}>
          <ArrowLeft aria-hidden="true" size={18} /> Tài khoản
        </button>
      </div>
      <div className="driver-console-stack">
        <article className="account-card driver-console-card">
          <div className="console-card-heading">
            <div>
              <p className="eyebrow">Trạng thái nhận việc</p>
              <h2>{displayWorkState(workState)}</h2>
            </div>
            <span className="driver-state-pill">
              {displayWorkState(workState)}
            </span>
          </div>
          <button
            className="primary-link"
            type="button"
            disabled={
              Boolean(current || currentDelivery) ||
              state.state === 'submitting'
            }
            onClick={toggleAvailability}
          >
            {workState === 'OFFLINE'
              ? 'Bật nhận chuyến'
              : 'Tạm ngừng nhận chuyến'}
          </button>
          {current || currentDelivery ? (
            <p className="notice">
              Trạng thái nhận việc đang bị khoá vì có một công việc đang xử lý.
            </p>
          ) : null}
        </article>

        <article className="account-card driver-console-card">
          <div className="form-heading">
            <h2>Đơn giao đang chờ</h2>
            <p>Đơn giao được giữ chỗ và nhận riêng với chuyến xe.</p>
          </div>
          {deliveryOffers.length ? (
            <div className="offer-list">
              {deliveryOffers.map((offer) => (
                <div className="offer-row" key={offer.id}>
                  <div>
                    <strong>Lời mời giao hàng lần {offer.attemptNumber}</strong>
                    <span>{offer.deliveryId}</span>
                  </div>
                  <button
                    className="secondary-link"
                    type="button"
                    disabled={state.state === 'submitting'}
                    onClick={() => acceptDeliveryOffer(offer.id)}
                  >
                    Nhận đơn giao
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="notice">Không có đơn giao đang chờ.</p>
          )}
        </article>

        <article className="account-card driver-console-card">
          <div className="form-heading">
            <h2>Đơn giao hiện tại</h2>
            <p>Chỉ xác nhận bàn giao khi thao tác đó đã thực sự xảy ra.</p>
          </div>
          {currentDelivery ? (
            <>
              <div className="notice location-sharing-panel">
                <strong>Chia sẻ vị trí khi đang nhận đơn</strong>
                <span>
                  Gove chỉ gửi GPS khi màn hình này đang mở và bạn cho phép;
                  không theo dõi vị trí nền.
                </span>
                <button
                  className="secondary-link"
                  type="button"
                  onClick={() =>
                    setLocationSharingEnabled((enabled) => !enabled)
                  }
                >
                  {locationSharingEnabled
                    ? 'Dừng chia sẻ vị trí'
                    : 'Cho phép chia sẻ vị trí'}
                </button>
              </div>
              <LiveMapPreview
                pickup={toMapPoint(currentDelivery.pickup)}
                dropoff={toMapPoint(currentDelivery.dropoff)}
                driver={
                  driverLocation
                    ? {
                        latitude: driverLocation.latitude,
                        longitude: driverLocation.longitude,
                        observedAt: driverLocation.receivedAt,
                      }
                    : null
                }
                kind="delivery"
              />
              <p className="map-caption" role="status">
                {driverLocationStatusLabel(locationState)}
              </p>
              <dl className="quote-details">
                <div>
                  <dt>Điểm lấy hàng</dt>
                  <dd>{currentDelivery.pickup.label}</dd>
                </div>
                <div>
                  <dt>Điểm giao hàng</dt>
                  <dd>{currentDelivery.dropoff.label}</dd>
                </div>
                <div>
                  <dt>Khoảng cách ước tính</dt>
                  <dd>
                    {formatDistance(
                      estimateCoordinateDistance(
                        currentDelivery.pickup,
                        currentDelivery.dropoff,
                      ),
                    )}
                  </dd>
                </div>
                <div>
                  <dt>ETA theo tọa độ</dt>
                  <dd>
                    {formatDuration(
                      estimateCoordinateDuration(
                        currentDelivery.pickup,
                        currentDelivery.dropoff,
                      ),
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Trạng thái</dt>
                  <dd>{displayDeliveryState(currentDelivery.state)}</dd>
                </div>
                <div>
                  <dt>Kiện hàng</dt>
                  <dd>{currentDelivery.parcelDescription}</dd>
                </div>
                <div>
                  <dt>Người nhận</dt>
                  <dd>{currentDelivery.recipientDisplayName}</dd>
                </div>
              </dl>
              <div className="driver-action-row">
                {currentDelivery.state === 'DRIVER_TO_PICKUP' ? (
                  <button
                    className="primary-link"
                    type="button"
                    disabled={state.state === 'submitting'}
                    onClick={() => transitionDelivery('arrive')}
                  >
                    Đã đến điểm lấy hàng
                  </button>
                ) : null}
                {currentDelivery.state === 'AT_PICKUP' ? (
                  <div className="delivery-confirmation">
                    <label htmlFor="custody-confirmation">
                      Xác nhận đã nhận kiện hàng
                    </label>
                    <input
                      id="custody-confirmation"
                      value={custodyConfirmation}
                      maxLength={120}
                      onChange={(event) =>
                        setCustodyConfirmation(event.target.value)
                      }
                      placeholder="Mô tả tình trạng kiện hàng đã nhận"
                    />
                    <button
                      className="primary-link"
                      type="button"
                      disabled={
                        !custodyConfirmation.trim() ||
                        state.state === 'submitting'
                      }
                      onClick={() => transitionDelivery('pickup')}
                    >
                      Xác nhận đã nhận kiện
                    </button>
                  </div>
                ) : null}
                {currentDelivery.state === 'IN_TRANSIT' ? (
                  <div className="delivery-confirmation">
                    <label htmlFor="recipient-proof">
                      Bằng chứng giao cho người nhận
                    </label>
                    <input
                      id="recipient-proof"
                      value={recipientProof}
                      maxLength={120}
                      onChange={(event) =>
                        setRecipientProof(event.target.value)
                      }
                      placeholder="Ghi nhận xác nhận của người nhận"
                    />
                    <button
                      className="primary-link"
                      type="button"
                      disabled={
                        !recipientProof.trim() || state.state === 'submitting'
                      }
                      onClick={() => transitionDelivery('complete')}
                    >
                      Xác nhận đã giao hàng
                    </button>
                  </div>
                ) : null}
              </div>
            </>
          ) : (
            <p className="notice">
              Hãy nhận một đơn giao để bắt đầu xử lý kiện hàng.
            </p>
          )}
        </article>

        <article className="account-card driver-console-card">
          <div className="form-heading">
            <h2>Lời mời chuyến xe</h2>
            <p>Lời mời được giữ chỗ phía server và tự hết hạn.</p>
          </div>
          {offers.length ? (
            <div className="offer-list">
              {offers.map((offer) => (
                <div className="offer-row" key={offer.id}>
                  <div>
                    <strong>Lời mời lần {offer.attemptNumber}</strong>
                    <span>{offer.tripId}</span>
                  </div>
                  <button
                    className="secondary-link"
                    type="button"
                    disabled={state.state === 'submitting'}
                    onClick={() => acceptOffer(offer.id)}
                  >
                    Nhận chuyến
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="notice">Không có lời mời nào đang chờ.</p>
          )}
        </article>

        <article className="account-card driver-console-card">
          <div className="form-heading">
            <h2>Chuyến xe hiện tại</h2>
            <p>Chỉ chuyển trạng thái theo lifecycle được server kiểm soát.</p>
          </div>
          {current ? (
            <>
              <div className="notice location-sharing-panel">
                <strong>Chia sẻ vị trí khi đang nhận chuyến</strong>
                <span>
                  Gove chỉ gửi GPS khi màn hình này đang mở và bạn cho phép;
                  không theo dõi vị trí nền.
                </span>
                <button
                  className="secondary-link"
                  type="button"
                  onClick={() =>
                    setLocationSharingEnabled((enabled) => !enabled)
                  }
                >
                  {locationSharingEnabled
                    ? 'Dừng chia sẻ vị trí'
                    : 'Cho phép chia sẻ vị trí'}
                </button>
              </div>
              <LiveMapPreview
                pickup={toMapPoint(current.pickup)}
                dropoff={toMapPoint(current.dropoff)}
                driver={
                  driverLocation
                    ? {
                        latitude: driverLocation.latitude,
                        longitude: driverLocation.longitude,
                        observedAt: driverLocation.receivedAt,
                      }
                    : null
                }
                kind="ride"
              />
              <p className="map-caption" role="status">
                {driverLocationStatusLabel(locationState)}
              </p>
              <dl className="quote-details">
                <div>
                  <dt>Điểm đón</dt>
                  <dd>{current.pickup.label}</dd>
                </div>
                <div>
                  <dt>Điểm đến</dt>
                  <dd>{current.dropoff.label}</dd>
                </div>
                <div>
                  <dt>Khoảng cách ước tính</dt>
                  <dd>
                    {formatDistance(
                      estimateCoordinateDistance(
                        current.pickup,
                        current.dropoff,
                      ),
                    )}
                  </dd>
                </div>
                <div>
                  <dt>ETA theo tọa độ</dt>
                  <dd>
                    {formatDuration(
                      estimateCoordinateDuration(
                        current.pickup,
                        current.dropoff,
                      ),
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Trạng thái</dt>
                  <dd>{displayTripState(current.state)}</dd>
                </div>
                <div>
                  <dt>Mã chuyến</dt>
                  <dd>{current.id}</dd>
                </div>
              </dl>
              <div className="driver-action-row">
                {current.state === 'DRIVER_TO_PICKUP' ? (
                  <button
                    className="primary-link"
                    type="button"
                    disabled={state.state === 'submitting'}
                    onClick={() => transition('arrive')}
                  >
                    Đã đến điểm đón
                  </button>
                ) : null}
                {current.state === 'AT_PICKUP' ? (
                  <button
                    className="primary-link"
                    type="button"
                    disabled={state.state === 'submitting'}
                    onClick={() => transition('start')}
                  >
                    Bắt đầu chuyến
                  </button>
                ) : null}
                {current.state === 'IN_PROGRESS' ? (
                  <button
                    className="primary-link"
                    type="button"
                    disabled={state.state === 'submitting'}
                    onClick={() => transition('complete')}
                  >
                    Hoàn tất chuyến
                  </button>
                ) : null}
              </div>
            </>
          ) : (
            <p className="notice">Hãy nhận lời mời để bắt đầu chuyến xe.</p>
          )}
        </article>
        {state.state === 'submitting' ? (
          <p className="notice" role="status">
            Đang cập nhật trạng thái Tài xế…
          </p>
        ) : null}
        {state.state === 'error' || commandError ? (
          <div className="form-error driver-console-error" role="alert">
            <span>
              {commandError ?? (state.state === 'error' ? state.message : '')}
            </span>
            <button
              className="inline-button"
              type="button"
              onClick={() => {
                setCommandError(null);
                setRefreshAttempt((current) => current + 1);
              }}
            >
              Thử tải lại
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

type RideFormValues = {
  pickupLabel: string;
  pickupLatitude: string;
  pickupLongitude: string;
  dropoffLabel: string;
  dropoffLatitude: string;
  dropoffLongitude: string;
  serviceType: 'MOTORBIKE_STANDARD' | 'CAR_STANDARD';
};

type DeliveryFormValues = {
  pickupLabel: string;
  pickupLatitude: string;
  pickupLongitude: string;
  dropoffLabel: string;
  dropoffLatitude: string;
  dropoffLongitude: string;
  recipientDisplayName: string;
  recipientContactPhone: string;
  parcelDescription: string;
  declaredWeightGrams: string;
};

const initialDeliveryForm: DeliveryFormValues = {
  pickupLabel: hanoiInnerCityDemoLocations.delivery.pickup.label,
  pickupLatitude: hanoiInnerCityDemoLocations.delivery.pickup.latitude,
  pickupLongitude: hanoiInnerCityDemoLocations.delivery.pickup.longitude,
  dropoffLabel: hanoiInnerCityDemoLocations.delivery.dropoff.label,
  dropoffLatitude: hanoiInnerCityDemoLocations.delivery.dropoff.latitude,
  dropoffLongitude: hanoiInnerCityDemoLocations.delivery.dropoff.longitude,
  recipientDisplayName: '',
  recipientContactPhone: '',
  parcelDescription: '',
  declaredWeightGrams: '500',
};

function DeliveryRequestPage({
  actor,
  accessToken,
  onSignIn,
  onAccount,
}: {
  actor: AuthenticatedActor | null;
  accessToken: string | null;
  onSignIn: () => void;
  onAccount: () => void;
}) {
  const [form, setForm] = useState<DeliveryFormValues>(initialDeliveryForm);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [delivery, setDelivery] = useState<DeliveryResponse | null>(null);
  const [match, setMatch] = useState<DeliveryMatchResponse | null>(null);
  const [deliveryDriverId, setDeliveryDriverId] = useState<string | null>(null);
  const [deliveryDriverLocation, setDeliveryDriverLocation] =
    useState<DeliveryDriverLocation | null>(null);
  const [locationNow, setLocationNow] = useState(() => Date.now());
  const [realtimeStatus, setRealtimeStatus] = useState<
    'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'
  >('idle');
  const [createState, setCreateState] = useState<RequestState>({
    state: 'idle',
  });
  const [activeDeliveryState, setActiveDeliveryState] = useState<RequestState>({
    state: 'submitting',
  });
  const [matchState, setMatchState] = useState<RequestState>({ state: 'idle' });
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const createKeyRef = useRef(crypto.randomUUID());
  const matchKeyRef = useRef(crypto.randomUUID());
  const seenRealtimeEventIdsRef = useRef(new Set<string>());

  useEffect(() => {
    if (!accessToken || !actor?.roles.includes('CUSTOMER')) return;
    let active = true;
    setActiveDeliveryState({ state: 'submitting' });
    void request<DeliveryResponse[]>('/deliveries/active', {
      headers: { authorization: `Bearer ${accessToken}` },
    })
      .then((activeDeliveries) => {
        if (!active) return;
        setActiveDeliveryState({ state: 'idle' });
        if (activeDeliveries.length === 0) return;
        if (activeDeliveries.length === 1) {
          setDelivery(activeDeliveries[0] ?? null);
          return;
        }
        setCreateState({
          state: 'error',
          message:
            'Bạn đang có nhiều đơn gửi hàng chưa hoàn tất. Hãy mở Tài khoản để chọn đơn cần tiếp tục theo dõi.',
        });
      })
      .catch((error: unknown) => {
        if (active) {
          setActiveDeliveryState({
            state: 'error',
            message: (error as Error).message,
          });
          setCreateState({ state: 'error', message: (error as Error).message });
        }
      });
    return () => {
      active = false;
    };
  }, [accessToken, actor?.id]);

  useEffect(() => {
    if (Object.keys(fieldErrors).length) errorSummaryRef.current?.focus();
  }, [fieldErrors]);

  useEffect(() => {
    if (!deliveryDriverLocation) return;
    const receivedAt = Date.parse(deliveryDriverLocation.receivedAt);
    const staleAt = Number.isFinite(receivedAt)
      ? Math.max(
          0,
          receivedAt + deliveryLiveLocationWindowMilliseconds - Date.now(),
        )
      : 0;
    const timer = window.setTimeout(
      () => setLocationNow(Date.now()),
      staleAt + 50,
    );
    return () => window.clearTimeout(timer);
  }, [deliveryDriverLocation?.receivedAt]);

  useEffect(() => {
    if (!delivery?.id || !accessToken) {
      setRealtimeStatus('idle');
      setDeliveryDriverId(null);
      setDeliveryDriverLocation(null);
      return;
    }
    let disposed = false;
    let reconnectTimer: number | undefined;
    let reconnectAttempt = 0;
    let socket: WebSocket | null = null;
    const websocketProtocol =
      window.location.protocol === 'https:' ? 'wss' : 'ws';
    const connect = () => {
      if (disposed) return;
      setRealtimeStatus(reconnectAttempt ? 'disconnected' : 'connecting');
      socket = new WebSocket(
        `${websocketProtocol}://${window.location.host}/ws`,
      );
      socket.onopen = () => {
        reconnectAttempt = 0;
        setRealtimeStatus('connected');
        socket?.send(JSON.stringify({ type: 'authenticate', accessToken }));
      };
      socket.onmessage = (event) => {
        let message: RealtimeMessage;
        try {
          message = JSON.parse(event.data as string) as RealtimeMessage;
        } catch {
          setRealtimeStatus('error');
          return;
        }
        if (message.type === 'authenticated') {
          socket?.send(
            JSON.stringify({ deliveryIds: [delivery.id], type: 'subscribe' }),
          );
          return;
        }
        if (message.type === 'delivery.snapshot' && message.snapshot) {
          const snapshot = message.snapshot as DeliveryRealtimeSnapshot;
          setDeliveryDriverId(snapshot.driverId);
          setDeliveryDriverLocation((current) => {
            if (snapshot.driverId !== current?.driverId) {
              return snapshot.driverLocation && snapshot.driverId
                ? { ...snapshot.driverLocation, driverId: snapshot.driverId }
                : null;
            }
            return snapshot.driverLocation && snapshot.driverId
              ? { ...snapshot.driverLocation, driverId: snapshot.driverId }
              : current;
          });
          setDelivery((current) => mergeRealtimeDelivery(current, snapshot));
          return;
        }
        if (
          message.type === 'delivery.event' &&
          message.deliveryId === delivery.id
        ) {
          if (
            message.eventId &&
            !rememberRealtimeEvent(
              seenRealtimeEventIdsRef.current,
              message.eventId,
            )
          ) {
            return;
          }
          const payload = message.payload;
          if (!payload || typeof payload !== 'object') return;
          const next = payload as {
            state?: DeliveryResponse['state'];
            version?: number;
            driverUserId?: string;
          };
          if (typeof next.driverUserId === 'string') {
            setDeliveryDriverId(next.driverUserId);
          }
          if (next.state && typeof next.version === 'number') {
            setDelivery((current) => mergeRealtimeDeliveryEvent(current, next));
          }
          return;
        }
        if (
          message.type === 'delivery.driver.location' &&
          message.deliveryId === delivery.id &&
          typeof message.driverId === 'string' &&
          typeof message.latitude === 'number' &&
          typeof message.longitude === 'number' &&
          typeof message.accuracyMeters === 'number' &&
          isValidMapPoint({
            latitude: message.latitude,
            longitude: message.longitude,
          }) &&
          Number.isFinite(message.accuracyMeters) &&
          message.accuracyMeters >= 0 &&
          typeof message.capturedAt === 'string' &&
          typeof message.receivedAt === 'string'
        ) {
          setDeliveryDriverId(message.driverId);
          setDeliveryDriverLocation((current) => {
            const nextLocation = {
              driverId: message.driverId as string,
              latitude: message.latitude as number,
              longitude: message.longitude as number,
              accuracyMeters: message.accuracyMeters as number,
              capturedAt: message.capturedAt as string,
              receivedAt: message.receivedAt as string,
            };
            return isNewerDriverLocation(current, nextLocation)
              ? nextLocation
              : current;
          });
          return;
        }
        if (message.type === 'error') setRealtimeStatus('error');
      };
      socket.onerror = () => {
        setRealtimeStatus('error');
      };
      socket.onclose = () => {
        if (disposed) return;
        setRealtimeStatus('disconnected');
        reconnectAttempt += 1;
        reconnectTimer = window.setTimeout(
          connect,
          Math.min(1000 * 2 ** Math.min(reconnectAttempt - 1, 3), 8000),
        );
      };
    };
    connect();
    return () => {
      disposed = true;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [accessToken, delivery?.id]);

  if (!actor || !accessToken || !actor.roles.includes('CUSTOMER')) {
    return <AccessRequired onSignIn={onSignIn} />;
  }

  const setValue = (name: keyof DeliveryFormValues, value: string) => {
    setForm((current) => ({ ...current, [name]: value }));
    setFieldErrors((current) => {
      if (!current[name]) return current;
      const next = { ...current };
      delete next[name];
      return next;
    });
  };

  const startMatching = async (nextDelivery: DeliveryResponse) => {
    setMatchState({ state: 'submitting' });
    try {
      const result = await request<DeliveryMatchResponse>(
        `/deliveries/${nextDelivery.id}/match`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${accessToken}`,
            'idempotency-key': matchKeyRef.current,
          },
        },
      );
      setMatch(result);
      setDelivery((current) =>
        current
          ? {
              ...current,
              state: result.deliveryState,
              version: result.deliveryVersion,
            }
          : current,
      );
      setMatchState({ state: 'idle' });
    } catch (error) {
      setMatchState({ state: 'error', message: (error as Error).message });
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (activeDeliveryState.state === 'submitting') return;
    const errors = validateDeliveryForm(form);
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      return;
    }
    setCreateState({ state: 'submitting' });
    try {
      const result = await request<DeliveryResponse>('/deliveries', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'idempotency-key': createKeyRef.current,
        },
        body: JSON.stringify({
          pickup: {
            label: form.pickupLabel.trim(),
            latitude: Number(form.pickupLatitude),
            longitude: Number(form.pickupLongitude),
          },
          dropoff: {
            label: form.dropoffLabel.trim(),
            latitude: Number(form.dropoffLatitude),
            longitude: Number(form.dropoffLongitude),
          },
          recipient: {
            displayName: form.recipientDisplayName.trim(),
            contactPhone: form.recipientContactPhone.trim(),
          },
          parcel: {
            description: form.parcelDescription.trim(),
            declaredWeightGrams: Number(form.declaredWeightGrams),
          },
        }),
      });
      setDelivery(result);
      setCreateState({ state: 'idle' });
      await startMatching(result);
    } catch (error) {
      setCreateState({ state: 'error', message: (error as Error).message });
    }
  };

  const createAnother = () => {
    setDelivery(null);
    setMatch(null);
    setDeliveryDriverId(null);
    setDeliveryDriverLocation(null);
    setCreateState({ state: 'idle' });
    setMatchState({ state: 'idle' });
    createKeyRef.current = crypto.randomUUID();
    matchKeyRef.current = crypto.randomUUID();
  };

  return (
    <section className="ride-layout delivery-request-layout">
      <div className="ride-intro">
        <p className="eyebrow">Gửi hàng</p>
        <h1>Gửi một kiện hàng, bàn giao rõ ràng.</h1>
        <p>
          Nhập điểm lấy, điểm giao, người nhận và thông tin kiện hàng. Gove ghi
          nhận yêu cầu trước rồi tìm một Tài xế phù hợp.
        </p>
        <button className="back-link" type="button" onClick={onAccount}>
          <ArrowLeft aria-hidden="true" size={18} /> Tài khoản
        </button>
      </div>
      <div className="ride-card-stack">
        {!delivery ? (
          <form
            className="auth-card ride-card"
            onSubmit={submit}
            noValidate
            aria-busy={
              createState.state === 'submitting' ||
              activeDeliveryState.state === 'submitting'
            }
          >
            <FormHeading
              title="Tạo đơn gửi hàng"
              subtitle="Bạn có thể dùng các điểm mô phỏng trong khu vực hiện tại."
            />
            <RoutePreview
              pickup={form.pickupLabel}
              pickupLatitude={form.pickupLatitude}
              pickupLongitude={form.pickupLongitude}
              dropoff={form.dropoffLabel}
              dropoffLatitude={form.dropoffLatitude}
              dropoffLongitude={form.dropoffLongitude}
              kind="delivery"
            />
            {Object.keys(fieldErrors).length ? (
              <div
                className="form-error-summary"
                role="alert"
                tabIndex={-1}
                ref={errorSummaryRef}
              >
                <strong>Vui lòng kiểm tra các trường được đánh dấu.</strong>
                <ul>
                  {Object.entries(fieldErrors).map(([field, message]) => (
                    <li key={field}>
                      <a href={`#${field}`}>{message}</a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <fieldset className="location-fieldset">
              <legend>Điểm lấy hàng</legend>
              <LocationFields
                prefix="pickup"
                form={form}
                fieldErrors={fieldErrors}
                onChange={setValue}
              />
            </fieldset>
            <fieldset className="location-fieldset">
              <legend>Điểm giao hàng</legend>
              <LocationFields
                prefix="dropoff"
                form={form}
                fieldErrors={fieldErrors}
                onChange={setValue}
              />
            </fieldset>
            <fieldset className="delivery-fieldset">
              <legend>Người nhận</legend>
              <label htmlFor="recipientDisplayName">Họ và tên</label>
              <input
                id="recipientDisplayName"
                autoComplete="name"
                maxLength={120}
                value={form.recipientDisplayName}
                onChange={(event) =>
                  setValue('recipientDisplayName', event.target.value)
                }
                aria-invalid={Boolean(fieldErrors.recipientDisplayName)}
                aria-describedby={
                  fieldErrors.recipientDisplayName
                    ? 'recipientDisplayName-error'
                    : undefined
                }
              />
              {fieldErrors.recipientDisplayName ? (
                <small id="recipientDisplayName-error" className="field-error">
                  {fieldErrors.recipientDisplayName}
                </small>
              ) : null}
              <label htmlFor="recipientContactPhone">Số điện thoại</label>
              <input
                id="recipientContactPhone"
                autoComplete="tel"
                inputMode="tel"
                maxLength={32}
                value={form.recipientContactPhone}
                onChange={(event) =>
                  setValue('recipientContactPhone', event.target.value)
                }
                aria-invalid={Boolean(fieldErrors.recipientContactPhone)}
                aria-describedby={
                  fieldErrors.recipientContactPhone
                    ? 'recipientContactPhone-error'
                    : undefined
                }
              />
              {fieldErrors.recipientContactPhone ? (
                <small id="recipientContactPhone-error" className="field-error">
                  {fieldErrors.recipientContactPhone}
                </small>
              ) : null}
            </fieldset>
            <fieldset className="delivery-fieldset">
              <legend>Thông tin kiện hàng</legend>
              <label htmlFor="parcelDescription">Mô tả</label>
              <input
                id="parcelDescription"
                maxLength={280}
                value={form.parcelDescription}
                onChange={(event) =>
                  setValue('parcelDescription', event.target.value)
                }
                aria-invalid={Boolean(fieldErrors.parcelDescription)}
                aria-describedby={
                  fieldErrors.parcelDescription
                    ? 'parcelDescription-error'
                    : undefined
                }
              />
              {fieldErrors.parcelDescription ? (
                <small id="parcelDescription-error" className="field-error">
                  {fieldErrors.parcelDescription}
                </small>
              ) : null}
              <label htmlFor="declaredWeightGrams">
                Khối lượng khai báo (gram)
              </label>
              <input
                id="declaredWeightGrams"
                inputMode="numeric"
                min="1"
                max="30000"
                type="number"
                value={form.declaredWeightGrams}
                onChange={(event) =>
                  setValue('declaredWeightGrams', event.target.value)
                }
                aria-invalid={Boolean(fieldErrors.declaredWeightGrams)}
                aria-describedby={
                  fieldErrors.declaredWeightGrams
                    ? 'declaredWeightGrams-error'
                    : undefined
                }
              />
              {fieldErrors.declaredWeightGrams ? (
                <small id="declaredWeightGrams-error" className="field-error">
                  {fieldErrors.declaredWeightGrams}
                </small>
              ) : null}
            </fieldset>
            <SubmitState
              state={createState}
              label="Tạo đơn gửi hàng"
              disabled={activeDeliveryState.state === 'submitting'}
              disabledLabel="Đang kiểm tra đơn gửi hàng hiện tại…"
            />
          </form>
        ) : (
          <article
            className="auth-card trip-success"
            aria-labelledby="delivery-result-heading"
          >
            <span className="success-icon">
              <CheckCircle aria-hidden="true" size={28} weight="fill" />
            </span>
            <p className="eyebrow">Đã ghi nhận đơn hàng</p>
            <h2 id="delivery-result-heading">
              Đơn hàng đang ở trạng thái{' '}
              <code>{displayDeliveryState(delivery.state)}</code>.
            </h2>
            <p>{deliveryStateDescription(delivery.state)}</p>
            <p
              className={`realtime-status realtime-status--${realtimeStatus}`}
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              <span aria-hidden="true" />
              {realtimeStatusLabel(realtimeStatus, 'đơn hàng')}
            </p>
            <JourneyStatus kind="delivery" state={delivery.state} />
            <DeliveryLiveMap
              delivery={delivery}
              driverId={deliveryDriverId}
              driverLocation={deliveryDriverLocation}
              now={locationNow}
              realtimeStatus={realtimeStatus}
            />
            <dl className="quote-details">
              <div>
                <dt>Điểm lấy hàng</dt>
                <dd>{delivery.pickup.label}</dd>
              </div>
              <div>
                <dt>Điểm giao hàng</dt>
                <dd>{delivery.dropoff.label}</dd>
              </div>
              <div>
                <dt>Người nhận</dt>
                <dd>{delivery.recipientDisplayName}</dd>
              </div>
              <div>
                <dt>Kiện hàng</dt>
                <dd>{delivery.parcelDescription}</dd>
              </div>
              <div>
                <dt>Khối lượng khai báo</dt>
                <dd>{formatWeight(delivery.declaredWeightGrams)}</dd>
              </div>
              <div>
                <dt>Phiên bản đơn hàng</dt>
                <dd>{delivery.version}</dd>
              </div>
            </dl>
            {matchState.state === 'submitting' ? (
              <p className="notice" role="status">
                Đang tìm Tài xế phù hợp…
              </p>
            ) : null}
            {matchState.state === 'error' ? (
              <>
                <p className="form-error" role="alert">
                  {matchState.message}
                </p>
                <button
                  className="secondary-link"
                  type="button"
                  onClick={() => void startMatching(delivery)}
                >
                  Tìm lại Tài xế
                </button>
              </>
            ) : null}
            {match?.offer &&
            matchState.state === 'idle' &&
            delivery.state === 'MATCHING' ? (
              <p className="notice">
                Đang chờ Tài xế nhận đơn. Màn hình sẽ tự cập nhật trạng thái.
              </p>
            ) : null}
            <div className="quote-actions">
              <button
                className="primary-link"
                type="button"
                onClick={onAccount}
              >
                Xem lịch sử gửi hàng
              </button>
              <button
                className="secondary-link"
                type="button"
                onClick={createAnother}
              >
                Tạo đơn khác
              </button>
            </div>
          </article>
        )}
      </div>
    </section>
  );
}

function DeliveryLiveMap({
  delivery,
  driverId,
  driverLocation,
  now,
  realtimeStatus,
}: {
  delivery: DeliveryResponse;
  driverId: string | null;
  driverLocation: DeliveryDriverLocation | null;
  now: number;
  realtimeStatus:
    'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';
}) {
  const pickup = toMapPoint(delivery.pickup);
  const dropoff = toMapPoint(delivery.dropoff);
  const hasAssignment =
    Boolean(driverId) ||
    ['DRIVER_TO_PICKUP', 'AT_PICKUP', 'IN_TRANSIT'].includes(delivery.state);
  const locationStatus = getDeliveryLocationStatus(
    hasAssignment,
    driverLocation,
    now,
    delivery.state,
  );
  const hasValidCoordinates =
    isValidMapPoint(pickup) && isValidMapPoint(dropoff);
  const driverCanBeShown =
    !isTerminalDeliveryState(delivery.state) &&
    ['live', 'stale'].includes(locationStatus) &&
    Boolean(driverLocation);
  const liveDriver = driverCanBeShown
    ? {
        latitude: driverLocation!.latitude,
        longitude: driverLocation!.longitude,
        observedAt: driverLocation!.receivedAt,
      }
    : null;

  return (
    <section
      className="delivery-live-map"
      aria-labelledby="delivery-live-map-heading"
    >
      <div className="delivery-live-map__heading">
        <div>
          <p className="eyebrow">Theo dõi đơn hàng</p>
          <h3 id="delivery-live-map-heading">Vị trí Tài xế</h3>
        </div>
        <span
          className={`location-state-pill location-state-pill--${locationStatus}`}
        >
          {deliveryLocationStatusLabel(locationStatus, realtimeStatus)}
        </span>
      </div>
      {hasValidCoordinates ? (
        <LiveMapPreview
          pickup={pickup}
          dropoff={dropoff}
          driver={liveDriver}
          kind="delivery"
        />
      ) : (
        <div
          className="route-map route-map--fallback delivery-map-fallback"
          role="img"
          aria-label="Không đủ tọa độ để hiển thị bản đồ giao hàng"
        >
          <MapPin size={32} aria-hidden="true" />
          <strong>Chưa thể hiển thị bản đồ nền</strong>
          <span>Hãy dùng bảng tọa độ bên dưới để kiểm tra lộ trình.</span>
        </div>
      )}
      <p className="map-caption delivery-location-caption" role="status">
        <NavigationArrow aria-hidden="true" size={16} weight="fill" />
        {deliveryLocationStatusMessage(
          locationStatus,
          driverLocation,
          realtimeStatus,
        )}
      </p>
      <details className="map-coordinate-fallback">
        <summary>Xem tọa độ để đối chiếu khi bản đồ không tải</summary>
        <dl>
          <div>
            <dt>Điểm lấy hàng</dt>
            <dd>{formatCoordinates(delivery.pickup)}</dd>
          </div>
          <div>
            <dt>Điểm giao hàng</dt>
            <dd>{formatCoordinates(delivery.dropoff)}</dd>
          </div>
          {driverLocation ? (
            <div>
              <dt>Vị trí Tài xế gần nhất</dt>
              <dd>{formatCoordinates(driverLocation)}</dd>
            </div>
          ) : null}
        </dl>
      </details>
    </section>
  );
}

function LocationFields({
  prefix,
  form,
  fieldErrors,
  onChange,
}: {
  prefix: 'pickup' | 'dropoff';
  form: DeliveryFormValues;
  fieldErrors: Record<string, string>;
  onChange: (name: keyof DeliveryFormValues, value: string) => void;
}) {
  const labelField = `${prefix}Label` as keyof DeliveryFormValues;
  const latitudeField = `${prefix}Latitude` as keyof DeliveryFormValues;
  const longitudeField = `${prefix}Longitude` as keyof DeliveryFormValues;
  const title = prefix === 'pickup' ? 'Điểm lấy hàng' : 'Điểm giao hàng';
  return (
    <>
      <label htmlFor={labelField}>Tên địa điểm</label>
      <input
        id={labelField}
        maxLength={160}
        value={form[labelField]}
        onChange={(event) => onChange(labelField, event.target.value)}
        aria-invalid={Boolean(fieldErrors[labelField])}
        aria-describedby={
          fieldErrors[labelField] ? `${labelField}-error` : undefined
        }
      />
      {fieldErrors[labelField] ? (
        <small id={`${labelField}-error`} className="field-error">
          {fieldErrors[labelField]}
        </small>
      ) : null}
      <div className="form-grid">
        <div>
          <label htmlFor={latitudeField}>Vĩ độ</label>
          <input
            id={latitudeField}
            inputMode="decimal"
            value={form[latitudeField]}
            onChange={(event) => onChange(latitudeField, event.target.value)}
            aria-invalid={Boolean(fieldErrors[latitudeField])}
            aria-describedby={
              fieldErrors[latitudeField] ? `${latitudeField}-error` : undefined
            }
          />
          {fieldErrors[latitudeField] ? (
            <small id={`${latitudeField}-error`} className="field-error">
              {fieldErrors[latitudeField]}
            </small>
          ) : null}
        </div>
        <div>
          <label htmlFor={longitudeField}>Kinh độ</label>
          <input
            id={longitudeField}
            inputMode="decimal"
            value={form[longitudeField]}
            onChange={(event) => onChange(longitudeField, event.target.value)}
            aria-invalid={Boolean(fieldErrors[longitudeField])}
            aria-describedby={
              fieldErrors[longitudeField]
                ? `${longitudeField}-error`
                : undefined
            }
          />
          {fieldErrors[longitudeField] ? (
            <small id={`${longitudeField}-error`} className="field-error">
              {fieldErrors[longitudeField]}
            </small>
          ) : null}
        </div>
      </div>
      <p className="helper-copy">{title} cần có vĩ độ và kinh độ hợp lệ.</p>
    </>
  );
}

function RoutePreview({
  pickup,
  pickupLatitude,
  pickupLongitude,
  dropoff,
  dropoffLatitude,
  dropoffLongitude,
  kind,
}: {
  pickup: string;
  pickupLatitude: string;
  pickupLongitude: string;
  dropoff: string;
  dropoffLatitude: string;
  dropoffLongitude: string;
  kind: 'ride' | 'delivery';
}) {
  const points = {
    pickup: {
      latitude: Number(pickupLatitude),
      longitude: Number(pickupLongitude),
    },
    dropoff: {
      latitude: Number(dropoffLatitude),
      longitude: Number(dropoffLongitude),
    },
  };
  const hasValidCoordinates = [points.pickup, points.dropoff].every(
    (point) =>
      Number.isFinite(point.latitude) &&
      Number.isFinite(point.longitude) &&
      Math.abs(point.latitude) <= 90 &&
      Math.abs(point.longitude) <= 180,
  );

  return (
    <div className="route-preview" role="group" aria-label="Xem trước lộ trình">
      {hasValidCoordinates ? (
        <LiveMapPreview
          pickup={points.pickup}
          dropoff={points.dropoff}
          kind={kind}
        />
      ) : (
        <div
          className="route-map route-map--fallback"
          role="img"
          aria-label="Chưa đủ tọa độ để hiển thị bản đồ"
        >
          <MapPin size={32} aria-hidden="true" />
          <strong>Nhập tọa độ hợp lệ để xem bản đồ</strong>
        </div>
      )}
      <div className="route-summary">
        <div>
          <span className="summary-label">
            {kind === 'ride' ? 'Lộ trình chuyến xe' : 'Lộ trình giao hàng'}
          </span>
          <strong>
            {pickup} → {dropoff}
          </strong>
        </div>
        <span className="planned-badge">
          {hasValidCoordinates ? 'Bản đồ vị trí' : 'Chưa đủ dữ liệu'}
        </span>
      </div>
    </div>
  );
}

function LiveMapPreview({
  pickup,
  dropoff,
  kind,
  driver,
  route,
}: {
  pickup: MapPoint;
  dropoff: MapPoint;
  kind: 'ride' | 'delivery';
  driver?: DriverMapPoint | null;
  route?: FareQuoteRoute;
}) {
  const [renderer, setRenderer] = useState<'maplibre' | 'leaflet'>(() =>
    mapLibreStyleUrl && supportsWebGl() ? 'maplibre' : 'leaflet',
  );

  if (renderer === 'maplibre' && mapLibreStyleUrl) {
    return (
      <MapLibreLiveMap
        pickup={pickup}
        dropoff={dropoff}
        driver={driver}
        route={route}
        kind={kind}
        styleUrl={mapLibreStyleUrl}
        onUnavailable={() => setRenderer('leaflet')}
      />
    );
  }

  return (
    <LeafletLiveMap
      pickup={pickup}
      dropoff={dropoff}
      driver={driver}
      route={route}
      kind={kind}
      mapLibreUnavailable={Boolean(mapLibreStyleUrl)}
    />
  );
}

function LeafletLiveMap({
  pickup,
  dropoff,
  kind,
  driver,
  route,
  mapLibreUnavailable,
}: {
  pickup: MapPoint;
  dropoff: MapPoint;
  kind: 'ride' | 'delivery';
  driver?: DriverMapPoint | null;
  route?: FareQuoteRoute;
  mapLibreUnavailable: boolean;
}) {
  const mapElementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const summaryId = useId();
  const driverMarkerRef = useRef<L.CircleMarker | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const previousObservationRef = useRef<{
    observedAt: number;
    point: MapPoint;
  } | null>(null);
  const [tileStatus, setTileStatus] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  );

  useEffect(() => {
    const element = mapElementRef.current;
    if (!element) return;

    const pickupPoint = L.latLng(pickup.latitude, pickup.longitude);
    const dropoffPoint = L.latLng(dropoff.latitude, dropoff.longitude);
    const map = L.map(element, {
      attributionControl: true,
      zoomControl: false,
      scrollWheelZoom: false,
      dragging: true,
    });
    mapRef.current = map;
    const tileTimeout = window.setTimeout(() => setTileStatus('error'), 3000);

    L.control
      .zoom({
        position: 'bottomright',
        zoomInTitle: 'Phóng to bản đồ',
        zoomOutTitle: 'Thu nhỏ bản đồ',
      })
      .addTo(map);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    })
      .on('load', () => {
        window.clearTimeout(tileTimeout);
        setTileStatus('ready');
      })
      .on('tileerror', () => {
        window.clearTimeout(tileTimeout);
        setTileStatus('error');
      })
      .addTo(map);

    const routePoints = getRouteLatLngs(pickup, dropoff, route);
    L.polyline(routePoints, {
      color: '#2563eb',
      dashArray: route?.usedFallback || !route ? '10 8' : undefined,
      lineCap: 'round',
      weight: 5,
    }).addTo(map);

    L.circleMarker(pickupPoint, {
      color: '#0f172a',
      fillColor: '#ffffff',
      fillOpacity: 1,
      radius: 9,
      weight: 4,
    })
      .bindTooltip(kind === 'ride' ? 'Điểm đón' : 'Điểm lấy hàng')
      .addTo(map);

    L.circleMarker(dropoffPoint, {
      color: '#2563eb',
      fillColor: '#dbeafe',
      fillOpacity: 1,
      radius: 9,
      weight: 4,
    })
      .bindTooltip(kind === 'ride' ? 'Điểm đến' : 'Điểm giao hàng')
      .addTo(map);

    const boundsPoints = [pickupPoint, dropoffPoint];
    map.fitBounds(L.latLngBounds(boundsPoints).pad(0.28), {
      animate: false,
      maxZoom: 15,
    });

    return () => {
      window.clearTimeout(tileTimeout);
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
      animationFrameRef.current = null;
      driverMarkerRef.current = null;
      mapRef.current = null;
      map.remove();
    };
  }, [
    dropoff.latitude,
    dropoff.longitude,
    kind,
    pickup.latitude,
    pickup.longitude,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (!driver) {
      driverMarkerRef.current?.remove();
      driverMarkerRef.current = null;
      previousObservationRef.current = null;
      return;
    }

    const target = { latitude: driver.latitude, longitude: driver.longitude };
    const observedAt = Date.parse(driver.observedAt);
    const previous = previousObservationRef.current;
    if (!driverMarkerRef.current) {
      driverMarkerRef.current = L.circleMarker(
        L.latLng(target.latitude, target.longitude),
        {
          color: '#92400e',
          fillColor: '#fbbf24',
          fillOpacity: 1,
          radius: 10,
          weight: 4,
        },
      )
        .bindTooltip('Vị trí Tài xế')
        .addTo(map);
      previousObservationRef.current = { observedAt, point: target };
      return;
    }

    const canAnimate =
      previous !== null &&
      Number.isFinite(observedAt) &&
      Number.isFinite(previous.observedAt) &&
      observedAt > previous.observedAt &&
      observedAt - previous.observedAt <=
        driverMarkerAnimationMaximumGapMilliseconds &&
      !prefersReducedMotion();
    const start = driverMarkerRef.current.getLatLng();
    previousObservationRef.current = { observedAt, point: target };
    if (!canAnimate) {
      driverMarkerRef.current.setLatLng([target.latitude, target.longitude]);
      return;
    }

    const duration = Math.min(
      Math.max(observedAt - previous.observedAt, 200),
      driverMarkerAnimationMaximumDurationMilliseconds,
    );
    const startedAt = performance.now();
    const animate = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      driverMarkerRef.current?.setLatLng([
        start.lat + (target.latitude - start.lat) * progress,
        start.lng + (target.longitude - start.lng) * progress,
      ]);
      if (progress < 1) {
        animationFrameRef.current = window.requestAnimationFrame(animate);
      } else {
        animationFrameRef.current = null;
      }
    };
    animationFrameRef.current = window.requestAnimationFrame(animate);
  }, [driver?.latitude, driver?.longitude, driver?.observedAt]);

  return (
    <div
      className={`route-map route-map--leaflet ${
        tileStatus === 'error' ? 'route-map--tile-error' : ''
      }`}
      role="region"
      aria-busy={tileStatus === 'loading'}
      aria-label={`Bản đồ ${kind === 'ride' ? 'chuyến xe' : 'giao hàng'} với điểm đi và điểm đến`}
      aria-describedby={summaryId}
    >
      <MapAccessibleSummary
        id={summaryId}
        pickup={pickup}
        dropoff={dropoff}
        driver={driver}
        route={route}
      />
      <div ref={mapElementRef} className="leaflet-map-host" />
      {mapLibreUnavailable ? (
        <span className="map-status map-status--fallback" role="status">
          Bản đồ vector chưa khả dụng; đang dùng bản đồ dự phòng.
        </span>
      ) : null}
      {tileStatus === 'loading' ? (
        <span
          className={`map-status ${mapLibreUnavailable ? 'map-status--secondary' : ''}`}
          role="status"
        >
          Đang tải bản đồ…
        </span>
      ) : null}
      {tileStatus === 'error' ? (
        <span
          className={`map-status ${mapLibreUnavailable ? 'map-status--secondary' : ''}`}
          role="status"
        >
          Bản đồ nền chưa tải; các điểm tọa độ vẫn được hiển thị.
        </span>
      ) : null}
      <span className="map-status map-status--route" role="status">
        {route?.usedFallback || !route
          ? 'Tuyến ước tính theo tọa độ'
          : 'Tuyến đề xuất theo dữ liệu đường'}
      </span>
    </div>
  );
}

function MapLibreLiveMap({
  pickup,
  dropoff,
  kind,
  driver,
  route,
  styleUrl,
  onUnavailable,
}: {
  pickup: MapPoint;
  dropoff: MapPoint;
  kind: 'ride' | 'delivery';
  driver?: DriverMapPoint | null;
  route?: FareQuoteRoute;
  styleUrl: string;
  onUnavailable: () => void;
}) {
  const mapElementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const mapLibreRef = useRef<MapLibreModule | null>(null);
  const driverMarkerRef = useRef<MapLibreMarker | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const previousObservationRef = useRef<{
    observedAt: number;
    point: MapPoint;
  } | null>(null);
  const fallbackReportedRef = useRef(false);
  const summaryId = useId();
  const [mapStatus, setMapStatus] = useState<'loading' | 'ready'>('loading');

  useEffect(() => {
    const element = mapElementRef.current;
    if (!element) return;
    let cancelled = false;
    let map: MapLibreMap | null = null;
    let loaded = false;
    const unavailableTimer = window.setTimeout(() => {
      if (!loaded) reportMapLibreUnavailable();
    }, 5_000);
    void import('maplibre-gl')
      .then((mapLibre) => {
        if (cancelled) return;
        mapLibreRef.current = mapLibre;
        mapLibre.setWorkerUrl(mapLibreWorkerUrl);
        try {
          map = new mapLibre.Map({
            attributionControl: false,
            container: element,
            dragRotate: false,
            keyboard: true,
            pitchWithRotate: false,
            scrollZoom: false,
            style: styleUrl,
          });
        } catch {
          window.clearTimeout(unavailableTimer);
          reportMapLibreUnavailable();
          return;
        }
        mapRef.current = map;
        map.addControl(
          new mapLibre.NavigationControl({ showCompass: false }),
          'bottom-right',
        );
        map.addControl(
          new mapLibre.AttributionControl({ compact: false }),
          'bottom-left',
        );
        map.on('error', () => {
          window.clearTimeout(unavailableTimer);
          reportMapLibreUnavailable();
        });
        map.once('load', () => {
          if (cancelled || !map) return;
          loaded = true;
          window.clearTimeout(unavailableTimer);
          const routeCoordinates = getRouteCoordinates(
            pickup,
            dropoff,
            route,
          ).map(
            ([longitude, latitude]) =>
              [longitude, latitude] as [number, number],
          );
          map.addSource('gove-route', {
            data: {
              geometry: {
                coordinates: routeCoordinates,
                type: 'LineString',
              },
              properties: {},
              type: 'Feature',
            },
            type: 'geojson',
          });
          map.addLayer({
            id: 'gove-route-line',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': '#2563eb',
              ...(route?.usedFallback || !route
                ? { 'line-dasharray': [2, 2] }
                : {}),
              'line-width': 5,
            },
            source: 'gove-route',
            type: 'line',
          });
          addMapLibreMarker(
            mapLibre,
            map,
            pickup,
            'map-marker map-marker--pickup',
            kind === 'ride' ? 'Điểm đón' : 'Điểm lấy hàng',
          );
          addMapLibreMarker(
            mapLibre,
            map,
            dropoff,
            'map-marker map-marker--dropoff',
            kind === 'ride' ? 'Điểm đến' : 'Điểm giao hàng',
          );
          map.fitBounds(
            [
              [pickup.longitude, pickup.latitude],
              [dropoff.longitude, dropoff.latitude],
            ],
            { animate: false, maxZoom: 15, padding: 48 },
          );
          setMapStatus('ready');
        });
      })
      .catch(() => {
        window.clearTimeout(unavailableTimer);
        reportMapLibreUnavailable();
      });
    return () => {
      cancelled = true;
      window.clearTimeout(unavailableTimer);
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
      animationFrameRef.current = null;
      driverMarkerRef.current = null;
      mapRef.current = null;
      mapLibreRef.current = null;
      map?.remove();
    };
  }, [
    dropoff.latitude,
    dropoff.longitude,
    kind,
    pickup.latitude,
    pickup.longitude,
    styleUrl,
  ]);

  const reportMapLibreUnavailable = () => {
    if (fallbackReportedRef.current) return;
    fallbackReportedRef.current = true;
    onUnavailable();
  };

  useEffect(() => {
    const map = mapRef.current;
    const mapLibre = mapLibreRef.current;
    if (!map || !mapLibre || !map.loaded()) return;
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (!driver) {
      driverMarkerRef.current?.remove();
      driverMarkerRef.current = null;
      previousObservationRef.current = null;
      return;
    }
    const target = { latitude: driver.latitude, longitude: driver.longitude };
    const observedAt = Date.parse(driver.observedAt);
    const previous = previousObservationRef.current;
    if (!driverMarkerRef.current) {
      driverMarkerRef.current = addMapLibreMarker(
        mapLibre,
        map,
        target,
        'map-marker map-marker--driver',
        'Vị trí Tài xế',
      );
      previousObservationRef.current = { observedAt, point: target };
      return;
    }
    const canAnimate =
      previous !== null &&
      Number.isFinite(observedAt) &&
      Number.isFinite(previous.observedAt) &&
      observedAt > previous.observedAt &&
      observedAt - previous.observedAt <=
        driverMarkerAnimationMaximumGapMilliseconds &&
      !prefersReducedMotion();
    const start = driverMarkerRef.current.getLngLat();
    previousObservationRef.current = { observedAt, point: target };
    if (!canAnimate) {
      driverMarkerRef.current.setLngLat([target.longitude, target.latitude]);
      return;
    }
    const duration = Math.min(
      Math.max(observedAt - previous.observedAt, 200),
      driverMarkerAnimationMaximumDurationMilliseconds,
    );
    const startedAt = performance.now();
    const animate = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      driverMarkerRef.current?.setLngLat([
        start.lng + (target.longitude - start.lng) * progress,
        start.lat + (target.latitude - start.lat) * progress,
      ]);
      if (progress < 1) {
        animationFrameRef.current = window.requestAnimationFrame(animate);
      } else {
        animationFrameRef.current = null;
      }
    };
    animationFrameRef.current = window.requestAnimationFrame(animate);
  }, [driver?.latitude, driver?.longitude, driver?.observedAt, mapStatus]);

  return (
    <div
      className="route-map route-map--maplibre"
      role="region"
      aria-busy={mapStatus === 'loading'}
      aria-label={`Bản đồ ${kind === 'ride' ? 'chuyến xe' : 'giao hàng'} với điểm đi và điểm đến`}
      aria-describedby={summaryId}
    >
      <MapAccessibleSummary
        id={summaryId}
        pickup={pickup}
        dropoff={dropoff}
        driver={driver}
        route={route}
      />
      <div ref={mapElementRef} className="maplibre-map-host" />
      {mapStatus === 'loading' ? (
        <span className="map-status" role="status">
          Đang tải bản đồ vector…
        </span>
      ) : null}
      {mapStatus === 'ready' ? (
        <span className="map-status map-status--route" role="status">
          {route?.usedFallback || !route
            ? 'Tuyến ước tính theo tọa độ'
            : 'Tuyến đề xuất theo dữ liệu đường'}
        </span>
      ) : null}
    </div>
  );
}

function MapAccessibleSummary({
  id,
  pickup,
  dropoff,
  driver,
  route,
}: {
  id: string;
  pickup: MapPoint;
  dropoff: MapPoint;
  driver?: DriverMapPoint | null;
  route?: FareQuoteRoute;
}) {
  const routeDescription =
    route?.usedFallback || !route
      ? 'Tuyến đang hiển thị là tuyến ước tính theo tọa độ, không phải tuyến đường thực tế.'
      : 'Tuyến đang hiển thị là tuyến đề xuất theo dữ liệu đường.';
  const driverDescription = driver
    ? `Vị trí Tài xế hiện tại: ${formatCoordinates(driver)}. ${formatDriverFreshness(driver.observedAt)}`
    : 'Vị trí Tài xế hiện tại: chưa có dữ liệu.';

  return (
    <p id={id} style={visuallyHiddenStyle}>
      Điểm đi: {formatCoordinates(pickup)}. Điểm đến:{' '}
      {formatCoordinates(dropoff)}. {driverDescription} {routeDescription}
    </p>
  );
}

const visuallyHiddenStyle = {
  border: 0,
  clip: 'rect(0 0 0 0)',
  height: 1,
  margin: -1,
  overflow: 'hidden',
  padding: 0,
  position: 'absolute' as const,
  whiteSpace: 'nowrap' as const,
  width: 1,
};

function getRouteCoordinates(
  pickup: MapPoint,
  dropoff: MapPoint,
  route?: FareQuoteRoute,
): readonly (readonly [number, number])[] {
  if (route && !route.usedFallback && route.geometry.coordinates.length >= 2) {
    return route.geometry.coordinates;
  }
  return [
    [pickup.longitude, pickup.latitude],
    [dropoff.longitude, dropoff.latitude],
  ];
}

function getRouteLatLngs(
  pickup: MapPoint,
  dropoff: MapPoint,
  route?: FareQuoteRoute,
): [number, number][] {
  return getRouteCoordinates(pickup, dropoff, route).map(
    ([longitude, latitude]) => [latitude, longitude],
  );
}

function addMapLibreMarker(
  mapLibre: MapLibreModule,
  map: MapLibreMap,
  point: MapPoint,
  className: string,
  label: string,
): MapLibreMarker {
  const element = document.createElement('span');
  element.className = className;
  element.setAttribute('aria-hidden', 'true');
  element.title = label;
  return new mapLibre.Marker({ element })
    .setLngLat([point.longitude, point.latitude])
    .addTo(map);
}

function prefersReducedMotion(): boolean {
  return (
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  );
}

function supportsWebGl(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

type MapPoint = {
  latitude: number;
  longitude: number;
};

function toMapPoint(point: MapPoint): MapPoint {
  return { latitude: point.latitude, longitude: point.longitude };
}

function isValidMapPoint(point: MapPoint): boolean {
  return (
    Number.isFinite(point.latitude) &&
    Number.isFinite(point.longitude) &&
    Math.abs(point.latitude) <= 90 &&
    Math.abs(point.longitude) <= 180
  );
}

function isTerminalDeliveryState(state: DeliveryResponse['state']): boolean {
  return ['DELIVERED', 'CANCELLED', 'NO_DRIVER_AVAILABLE'].includes(state);
}

function isTerminalTripState(
  state: TripResponse['state'] | undefined,
): boolean {
  return Boolean(
    state && ['COMPLETED', 'CANCELLED', 'NO_DRIVER_AVAILABLE'].includes(state),
  );
}

function isCurrentDriverLocation(
  location: DriverLocationSnapshot,
  now: number,
): boolean {
  const receivedAt = Date.parse(location.receivedAt);
  return (
    Number.isFinite(receivedAt) &&
    receivedAt + deliveryLiveLocationWindowMilliseconds > now
  );
}

function driverLocationStatusLabel(
  state:
    | 'idle'
    | 'requesting'
    | 'sending'
    | 'sent'
    | 'denied'
    | 'unsupported'
    | 'error',
): string {
  switch (state) {
    case 'requesting':
      return 'Đang xin quyền vị trí để cập nhật GPS khi ứng dụng đang mở.';
    case 'sending':
      return 'Đang gửi vị trí GPS mới nhất…';
    case 'sent':
      return 'Đã gửi vị trí GPS gần nhất. Ứng dụng không theo dõi nền.';
    case 'denied':
      return 'Bạn chưa cấp quyền vị trí; hãy cho phép để cập nhật GPS.';
    case 'unsupported':
      return 'Trình duyệt không hỗ trợ vị trí GPS.';
    case 'error':
      return 'Chưa gửi được vị trí GPS; hệ thống sẽ thử lại ở lần cập nhật sau.';
    default:
      return 'Vị trí GPS chỉ hoạt động khi có chuyến hoặc đơn đang xử lý.';
  }
}

function formatCoordinates(point: MapPoint): string {
  return `${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}`;
}

function formatDriverFreshness(observedAt: string): string {
  const timestamp = Date.parse(observedAt);
  if (!Number.isFinite(timestamp)) {
    return 'Thời điểm cập nhật vị trí không xác định.';
  }
  const ageMilliseconds = Math.max(0, Date.now() - timestamp);
  if (ageMilliseconds <= driverMarkerAnimationMaximumGapMilliseconds) {
    return 'Vị trí vừa được cập nhật.';
  }
  return `Vị trí được cập nhật khoảng ${Math.round(ageMilliseconds / 1000)} giây trước; có thể đã cũ.`;
}

type DeliveryLocationStatus =
  'unassigned' | 'missing' | 'live' | 'stale' | 'ended';

function getDeliveryLocationStatus(
  hasAssignment: boolean,
  location: DeliveryDriverLocation | null,
  now: number,
  deliveryState: DeliveryResponse['state'],
): DeliveryLocationStatus {
  if (isTerminalDeliveryState(deliveryState)) return 'ended';
  if (!hasAssignment) return 'unassigned';
  if (!location) return 'missing';
  const receivedAt = Date.parse(location.receivedAt);
  if (
    !Number.isFinite(receivedAt) ||
    now - receivedAt > deliveryLiveLocationWindowMilliseconds
  ) {
    return 'stale';
  }
  return 'live';
}

function deliveryLocationStatusLabel(
  status: DeliveryLocationStatus,
  realtimeStatus:
    'idle' | 'connecting' | 'connected' | 'disconnected' | 'error',
): string {
  switch (status) {
    case 'live':
      if (realtimeStatus === 'disconnected' || realtimeStatus === 'error') {
        return 'Mất kết nối';
      }
      return 'Đang cập nhật';
    case 'stale':
      return 'Đã cũ';
    case 'missing':
      return 'Chưa có vị trí';
    case 'ended':
      return 'Đã kết thúc';
    default:
      return 'Chưa phân công';
  }
}

function deliveryLocationStatusMessage(
  status: DeliveryLocationStatus,
  location: DeliveryDriverLocation | null,
  realtimeStatus:
    'idle' | 'connecting' | 'connected' | 'disconnected' | 'error',
): string {
  if (status === 'ended')
    return 'Đơn hàng đã kết thúc; vị trí không còn cập nhật.';
  if (status === 'unassigned') return 'Đơn hàng chưa được phân công Tài xế.';
  if (status === 'missing') {
    return 'Đơn hàng đã được phân công; đang chờ vị trí Tài xế đầu tiên.';
  }
  if (!location) return 'Chưa có dữ liệu vị trí Tài xế.';
  const updatedAt = new Date(location.receivedAt).toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  if (status === 'stale') {
    return `Vị trí gần nhất lúc ${updatedAt}; dữ liệu đã quá 15 giây.`;
  }
  if (realtimeStatus === 'disconnected' || realtimeStatus === 'error') {
    return `Mất kết nối cập nhật trực tiếp; đang dùng vị trí gần nhất lúc ${updatedAt}.`;
  }
  return `Vị trí Tài xế đang cập nhật; lần nhận gần nhất lúc ${updatedAt}.`;
}

function JourneyStatus({
  kind,
  state,
}: {
  kind: 'ride' | 'delivery';
  state: string;
}) {
  const steps =
    kind === 'ride'
      ? [
          { states: ['REQUESTED', 'MATCHING'], label: 'Tìm Tài xế' },
          { states: ['DRIVER_TO_PICKUP'], label: 'Đến điểm đón' },
          { states: ['AT_PICKUP'], label: 'Đón khách' },
          { states: ['IN_PROGRESS'], label: 'Đang di chuyển' },
          { states: ['COMPLETED'], label: 'Hoàn tất' },
        ]
      : [
          { states: ['REQUESTED', 'MATCHING'], label: 'Tìm Tài xế' },
          { states: ['DRIVER_TO_PICKUP'], label: 'Đến điểm lấy hàng' },
          { states: ['AT_PICKUP'], label: 'Nhận hàng' },
          { states: ['IN_TRANSIT'], label: 'Đang giao hàng' },
          { states: ['DELIVERED'], label: 'Đã giao hàng' },
        ];
  const currentIndex = Math.max(
    0,
    steps.findIndex((step) => step.states.includes(state)),
  );
  const terminalFailure = [
    'NO_DRIVER_AVAILABLE',
    'CANCELLED',
    'FAILED',
  ].includes(state);
  return (
    <ol className="journey-status" aria-label="Tiến trình xử lý">
      {steps.map((step, index) => (
        <li
          key={step.label}
          className={index < currentIndex ? 'is-complete' : undefined}
          aria-current={
            !terminalFailure && index === currentIndex ? 'step' : undefined
          }
        >
          <div>
            <strong>{step.label}</strong>
            <span>
              {terminalFailure && index === currentIndex
                ? displayTripState(state)
                : index < currentIndex
                  ? 'Đã hoàn tất'
                  : index === currentIndex
                    ? 'Đang xử lý'
                    : 'Đang chờ'}
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}

const initialRideForm: RideFormValues = {
  pickupLabel: hanoiInnerCityDemoLocations.ride.pickup.label,
  pickupLatitude: hanoiInnerCityDemoLocations.ride.pickup.latitude,
  pickupLongitude: hanoiInnerCityDemoLocations.ride.pickup.longitude,
  dropoffLabel: hanoiInnerCityDemoLocations.ride.dropoff.label,
  dropoffLatitude: hanoiInnerCityDemoLocations.ride.dropoff.latitude,
  dropoffLongitude: hanoiInnerCityDemoLocations.ride.dropoff.longitude,
  serviceType: 'MOTORBIKE_STANDARD',
};

function RideRequestPage({
  actor,
  accessToken,
  onSignIn,
  onAccount,
}: {
  actor: AuthenticatedActor | null;
  accessToken: string | null;
  onSignIn: () => void;
  onAccount: () => void;
}) {
  const [form, setForm] = useState<RideFormValues>(initialRideForm);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [quote, setQuote] = useState<FareQuoteResponse | null>(null);
  const [trip, setTrip] = useState<TripDetailResponse | null>(null);
  const [driverLocation, setDriverLocation] =
    useState<DriverLocationSnapshot | null>(null);
  const [dispatch, setDispatch] = useState<DispatchMatchResponse | null>(null);
  const [payment, setPayment] = useState<PaymentAttemptResponse | null>(null);
  const [realtimeStatus, setRealtimeStatus] = useState<
    'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'
  >('idle');
  const [quoteState, setQuoteState] = useState<RequestState>({ state: 'idle' });
  const [tripState, setTripState] = useState<RequestState>({ state: 'idle' });
  const [currentTripState, setCurrentTripState] = useState<RequestState>({
    state: 'submitting',
  });
  const [paymentState, setPaymentState] = useState<RequestState>({
    state: 'idle',
  });
  const [isCancellationDialogOpen, setCancellationDialogOpen] = useState(false);
  const [cancellationReasonCode, setCancellationReasonCode] =
    useState<CancellationReasonCode>('CHANGE_OF_PLANS');
  const [cancellationReasonDetail, setCancellationReasonDetail] = useState('');
  const [cancellationState, setCancellationState] = useState<RequestState>({
    state: 'idle',
  });
  const [cancellation, setCancellation] = useState<
    CancelTripResponse['cancellation'] | null
  >(null);
  const [now, setNow] = useState(() => Date.now());
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const cancellationDialogRef = useRef<HTMLDivElement>(null);
  const cancellationTriggerRef = useRef<HTMLButtonElement>(null);
  const quoteKeyRef = useRef(crypto.randomUUID());
  const tripKeyRef = useRef(crypto.randomUUID());
  const matchKeyRef = useRef(crypto.randomUUID());
  const cancellationKeyRef = useRef(crypto.randomUUID());
  const seenRealtimeEventIdsRef = useRef(new Set<string>());
  const [currentTripRecoveryAttempt, setCurrentTripRecoveryAttempt] =
    useState(0);

  useEffect(() => {
    if (!accessToken || !actor?.roles.includes('CUSTOMER')) return;
    let active = true;
    setCurrentTripState({ state: 'submitting' });
    void request<ActiveTripResponse | null>('/trips/current', {
      headers: { authorization: `Bearer ${accessToken}` },
    })
      .then((current) => {
        if (!active) return;
        setCurrentTripState({ state: 'idle' });
        if (!current) return;
        setTrip(current);
        setQuote({
          id: current.fareQuoteId,
          serviceType: current.serviceType,
          pickup: current.pickup,
          dropoff: current.dropoff,
          estimatedDistanceMeters: 0,
          estimatedDurationSeconds: 0,
          currency: current.currency,
          totalFareMinor: current.quotedTotalFareMinor,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        });
      })
      .catch((error: unknown) => {
        if (active) {
          setCurrentTripState({
            state: 'error',
            message: (error as Error).message,
          });
        }
      });
    return () => {
      active = false;
    };
  }, [accessToken, actor?.id, currentTripRecoveryAttempt]);

  useEffect(() => {
    if (!Object.keys(fieldErrors).length) return;
    errorSummaryRef.current?.focus();
  }, [fieldErrors]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!isCancellationDialogOpen) return;
    cancellationDialogRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && cancellationState.state !== 'submitting') {
        setCancellationDialogOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = Array.from(
        cancellationDialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled])',
        ) ?? [],
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cancellationState.state, isCancellationDialogOpen]);

  useEffect(() => {
    if (!isCancellationDialogOpen) {
      cancellationTriggerRef.current?.focus();
    }
  }, [isCancellationDialogOpen]);

  useEffect(() => {
    if (!trip?.id || !accessToken) {
      setRealtimeStatus('idle');
      setDriverLocation(null);
      return;
    }

    let disposed = false;
    let reconnectTimer: number | undefined;
    let reconnectAttempt = 0;
    let socket: WebSocket | null = null;
    const websocketProtocol =
      window.location.protocol === 'https:' ? 'wss' : 'ws';
    const connect = () => {
      if (disposed) return;
      setRealtimeStatus(reconnectAttempt ? 'disconnected' : 'connecting');
      socket = new WebSocket(
        `${websocketProtocol}://${window.location.host}/ws`,
      );
      socket.onopen = () => {
        reconnectAttempt = 0;
        setRealtimeStatus('connected');
        socket?.send(JSON.stringify({ type: 'authenticate', accessToken }));
      };
      socket.onmessage = (event) => {
        let message: RealtimeMessage;
        try {
          message = JSON.parse(event.data as string) as RealtimeMessage;
        } catch {
          setRealtimeStatus('error');
          return;
        }
        if (message.type === 'authenticated') {
          socket?.send(
            JSON.stringify({ type: 'subscribe', tripIds: [trip.id] }),
          );
          return;
        }
        if (message.type === 'trip.snapshot' && message.snapshot) {
          const snapshot = message.snapshot as TripRealtimeSnapshot;
          setDriverLocation(snapshot.driverLocation);
          setTrip((current) => mergeRealtimeTrip(current, snapshot));
          return;
        }
        if (message.type === 'trip.event' && message.tripId === trip.id) {
          if (
            message.eventId &&
            !rememberRealtimeEvent(
              seenRealtimeEventIdsRef.current,
              message.eventId,
            )
          ) {
            return;
          }
          const payload = message.payload;
          if (!payload || typeof payload !== 'object') return;
          const next = payload as {
            state?: TripResponse['state'];
            version?: number;
            actualDistanceMeters?: number;
            actualDurationSeconds?: number;
            finalFareMinor?: number;
            completedAt?: string;
            driverLocation?: DriverLocationSnapshot | null;
          };
          if (next.driverLocation !== undefined) {
            if (next.driverLocation === null) {
              setDriverLocation(null);
            } else {
              setDriverLocation((current) =>
                isNewerDriverLocation(current, next.driverLocation!)
                  ? next.driverLocation!
                  : current,
              );
            }
          }
          if (next.state && typeof next.version === 'number') {
            setTrip((current) => mergeRealtimeTripEvent(current, next));
          }
          return;
        }
        if (message.type === 'error') setRealtimeStatus('error');
      };
      socket.onerror = () => {
        setDriverLocation(null);
        setRealtimeStatus('error');
      };
      socket.onclose = () => {
        if (disposed) return;
        setDriverLocation(null);
        setRealtimeStatus('disconnected');
        reconnectAttempt += 1;
        reconnectTimer = window.setTimeout(
          connect,
          Math.min(1000 * 2 ** Math.min(reconnectAttempt - 1, 3), 8000),
        );
      };
    };
    connect();
    return () => {
      disposed = true;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [accessToken, trip?.id]);

  if (!actor || !accessToken || !actor.roles.includes('CUSTOMER')) {
    return <AccessRequired onSignIn={onSignIn} />;
  }

  const quoteExpired = quote
    ? new Date(quote.expiresAt).getTime() <= now
    : false;
  const activeQuote = quote;
  const visibleDriverLocation =
    driverLocation && !isTerminalTripState(trip?.state) ? driverLocation : null;
  const hasFreshDriverLocation = Boolean(
    visibleDriverLocation &&
    isCurrentDriverLocation(visibleDriverLocation, now),
  );
  const setValue = (name: keyof RideFormValues, value: string) => {
    setForm((current) => ({ ...current, [name]: value }));
    setFieldErrors((current) => {
      if (!current[name]) return current;
      const next = { ...current };
      delete next[name];
      return next;
    });
  };

  const handleQuote = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (currentTripState.state === 'submitting') return;
    const errors = validateRideForm(form);
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      return;
    }
    if (quote) {
      setQuote(null);
      setTrip(null);
      setDispatch(null);
      setPayment(null);
      setCancellation(null);
      setPaymentState({ state: 'idle' });
      quoteKeyRef.current = crypto.randomUUID();
      tripKeyRef.current = crypto.randomUUID();
      matchKeyRef.current = crypto.randomUUID();
    }
    setQuoteState({ state: 'submitting' });
    try {
      const result = await request<FareQuoteResponse>('/pricing/fare-quotes', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'idempotency-key': quoteKeyRef.current,
        },
        body: JSON.stringify({
          pickup: {
            label: form.pickupLabel,
            latitude: Number(form.pickupLatitude),
            longitude: Number(form.pickupLongitude),
          },
          dropoff: {
            label: form.dropoffLabel,
            latitude: Number(form.dropoffLatitude),
            longitude: Number(form.dropoffLongitude),
          },
          serviceType: form.serviceType,
        }),
      });
      setQuote(result);
      setTrip(null);
      setPayment(null);
      setCancellation(null);
      setPaymentState({ state: 'idle' });
      setQuoteState({ state: 'idle' });
    } catch (error) {
      setQuoteState({ state: 'error', message: (error as Error).message });
    }
  };

  const editLocations = () => {
    setQuote(null);
    setTrip(null);
    setDispatch(null);
    setPayment(null);
    setCancellation(null);
    setPaymentState({ state: 'idle' });
    setQuoteState({ state: 'idle' });
    setTripState({ state: 'idle' });
    quoteKeyRef.current = crypto.randomUUID();
    tripKeyRef.current = crypto.randomUUID();
    matchKeyRef.current = crypto.randomUUID();
  };

  const openCancellationDialog = () => {
    cancellationKeyRef.current = crypto.randomUUID();
    setCancellationReasonCode('CHANGE_OF_PLANS');
    setCancellationReasonDetail('');
    setCancellationState({ state: 'idle' });
    setCancellationDialogOpen(true);
  };

  const closeCancellationDialog = () => {
    if (cancellationState.state === 'submitting') return;
    setCancellationDialogOpen(false);
  };

  const submitCancellation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!trip || !isCustomerCancellableTrip(trip.state)) return;

    const reasonDetail = cancellationReasonDetail.trim();
    if (cancellationReasonCode === 'OTHER' && reasonDetail.length < 3) {
      setCancellationState({
        state: 'error',
        message: 'Hãy nhập ít nhất 3 ký tự để mô tả lý do khác.',
      });
      return;
    }

    setCancellationState({ state: 'submitting' });
    try {
      const result = await request<CancelTripResponse>(
        `/trips/${trip.id}/cancel`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${accessToken}`,
            'idempotency-key': cancellationKeyRef.current,
          },
          body: JSON.stringify({
            reasonCode: cancellationReasonCode,
            ...(reasonDetail ? { reasonDetail } : {}),
          }),
        },
      );
      setTrip((current) => {
        if (
          !current ||
          current.id !== result.id ||
          result.version < current.version
        ) {
          return current;
        }
        return { ...current, ...result };
      });
      setCancellation(result.cancellation);
      setDispatch(null);
      setCancellationState({ state: 'idle' });
    } catch (error) {
      setCancellationState({
        state: 'error',
        message: (error as Error).message,
      });
    }
  };

  const requestMatching = async (
    tripId: string,
  ): Promise<DispatchMatchResponse> =>
    request<DispatchMatchResponse>(`/dispatch/trips/${tripId}/match`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'idempotency-key': matchKeyRef.current,
      },
    });

  const applyMatchingResult = (matching: DispatchMatchResponse) => {
    setDispatch(matching);
    setTrip((current) =>
      current
        ? {
            ...current,
            state: matching.tripState,
            version: matching.tripVersion,
          }
        : current,
    );
  };

  const retryMatching = async () => {
    if (!trip) return;
    setTripState({ state: 'submitting' });
    try {
      applyMatchingResult(await requestMatching(trip.id));
      setTripState({ state: 'idle' });
    } catch (error) {
      setTripState({ state: 'error', message: (error as Error).message });
    }
  };

  const handleTrip = async () => {
    if (!quote || quoteExpired) return;
    setTripState({ state: 'submitting' });
    try {
      const result = await request<TripResponse>('/trips', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'idempotency-key': tripKeyRef.current,
        },
        body: JSON.stringify({ fareQuoteId: quote.id }),
      });
      setTrip(toTripDetail(result));
      applyMatchingResult(await requestMatching(result.id));
      setTripState({ state: 'idle' });
    } catch (error) {
      setTripState({ state: 'error', message: (error as Error).message });
    }
  };

  const capturePayment = async () => {
    if (!trip || trip.state !== 'COMPLETED') return;
    setPaymentState({ state: 'submitting' });
    try {
      const result = await request<PaymentAttemptResponse>(
        `/payments/trips/${trip.id}/capture`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${accessToken}`,
            'idempotency-key': crypto.randomUUID(),
          },
          body: JSON.stringify({ simulationOutcome: 'SUCCEEDED' }),
        },
      );
      setPayment(result);
      setPaymentState({ state: 'idle' });
    } catch (error) {
      setPaymentState({ state: 'error', message: (error as Error).message });
    }
  };

  return (
    <section className="ride-layout">
      <div className="ride-intro">
        <p className="eyebrow">Đặt chuyến</p>
        <h1>Đặt một hành trình rõ ràng.</h1>
        <p>
          Nhập điểm đi và điểm đến để xem giá ước tính, gửi yêu cầu và theo dõi
          trạng thái trực tiếp. Bản đồ hiển thị vị trí pickup/dropoff; route
          theo đường thực tế và GPS nền sẽ được bổ sung trong milestone tiếp
          theo.
        </p>
        <button className="back-link" type="button" onClick={onAccount}>
          <ArrowLeft aria-hidden="true" size={18} /> Tài khoản
        </button>
      </div>
      <div className="ride-card-stack">
        {!activeQuote ? (
          <form
            className="auth-card ride-card"
            onSubmit={handleQuote}
            aria-busy={
              quoteState.state === 'submitting' ||
              currentTripState.state === 'submitting'
            }
          >
            <FormHeading
              title="Thông tin chuyến đi"
              subtitle="Bạn có thể dùng các điểm mô phỏng trong khu vực hiện tại."
            />
            <RoutePreview
              pickup={form.pickupLabel}
              pickupLatitude={form.pickupLatitude}
              pickupLongitude={form.pickupLongitude}
              dropoff={form.dropoffLabel}
              dropoffLatitude={form.dropoffLatitude}
              dropoffLongitude={form.dropoffLongitude}
              kind="ride"
            />
            {Object.keys(fieldErrors).length ? (
              <div
                className="form-error-summary"
                role="alert"
                tabIndex={-1}
                ref={errorSummaryRef}
              >
                <strong>Vui lòng kiểm tra các trường được đánh dấu.</strong>
                <ul>
                  {Object.entries(fieldErrors).map(([field, message]) => (
                    <li key={field}>
                      <a href={`#${field}`}>{message}</a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <fieldset className="location-fieldset">
              <legend>Điểm đón</legend>
              <label htmlFor="pickupLabel">Tên điểm đón</label>
              <input
                id="pickupLabel"
                value={form.pickupLabel}
                onChange={(event) =>
                  setValue('pickupLabel', event.target.value)
                }
                aria-invalid={Boolean(fieldErrors.pickupLabel)}
                aria-describedby={
                  fieldErrors.pickupLabel ? 'pickupLabel-error' : undefined
                }
              />
              {fieldErrors.pickupLabel ? (
                <small id="pickupLabel-error" className="field-error">
                  {fieldErrors.pickupLabel}
                </small>
              ) : null}
              <div className="form-grid">
                <div>
                  <label htmlFor="pickupLatitude">Vĩ độ</label>
                  <input
                    id="pickupLatitude"
                    inputMode="decimal"
                    value={form.pickupLatitude}
                    onChange={(event) =>
                      setValue('pickupLatitude', event.target.value)
                    }
                    aria-invalid={Boolean(fieldErrors.pickupLatitude)}
                    aria-describedby={
                      fieldErrors.pickupLatitude
                        ? 'pickupLatitude-error'
                        : undefined
                    }
                  />
                  {fieldErrors.pickupLatitude ? (
                    <small id="pickupLatitude-error" className="field-error">
                      {fieldErrors.pickupLatitude}
                    </small>
                  ) : null}
                </div>
                <div>
                  <label htmlFor="pickupLongitude">Kinh độ</label>
                  <input
                    id="pickupLongitude"
                    inputMode="decimal"
                    value={form.pickupLongitude}
                    onChange={(event) =>
                      setValue('pickupLongitude', event.target.value)
                    }
                    aria-invalid={Boolean(fieldErrors.pickupLongitude)}
                    aria-describedby={
                      fieldErrors.pickupLongitude
                        ? 'pickupLongitude-error'
                        : undefined
                    }
                  />
                  {fieldErrors.pickupLongitude ? (
                    <small id="pickupLongitude-error" className="field-error">
                      {fieldErrors.pickupLongitude}
                    </small>
                  ) : null}
                </div>
              </div>
            </fieldset>
            <fieldset className="location-fieldset">
              <legend>Điểm đến</legend>
              <label htmlFor="dropoffLabel">Tên điểm đến</label>
              <input
                id="dropoffLabel"
                value={form.dropoffLabel}
                onChange={(event) =>
                  setValue('dropoffLabel', event.target.value)
                }
                aria-invalid={Boolean(fieldErrors.dropoffLabel)}
                aria-describedby={
                  fieldErrors.dropoffLabel ? 'dropoffLabel-error' : undefined
                }
              />
              {fieldErrors.dropoffLabel ? (
                <small id="dropoffLabel-error" className="field-error">
                  {fieldErrors.dropoffLabel}
                </small>
              ) : null}
              <div className="form-grid">
                <div>
                  <label htmlFor="dropoffLatitude">Vĩ độ</label>
                  <input
                    id="dropoffLatitude"
                    inputMode="decimal"
                    value={form.dropoffLatitude}
                    onChange={(event) =>
                      setValue('dropoffLatitude', event.target.value)
                    }
                    aria-invalid={Boolean(fieldErrors.dropoffLatitude)}
                    aria-describedby={
                      fieldErrors.dropoffLatitude
                        ? 'dropoffLatitude-error'
                        : undefined
                    }
                  />
                  {fieldErrors.dropoffLatitude ? (
                    <small id="dropoffLatitude-error" className="field-error">
                      {fieldErrors.dropoffLatitude}
                    </small>
                  ) : null}
                </div>
                <div>
                  <label htmlFor="dropoffLongitude">Kinh độ</label>
                  <input
                    id="dropoffLongitude"
                    inputMode="decimal"
                    value={form.dropoffLongitude}
                    onChange={(event) =>
                      setValue('dropoffLongitude', event.target.value)
                    }
                    aria-invalid={Boolean(fieldErrors.dropoffLongitude)}
                    aria-describedby={
                      fieldErrors.dropoffLongitude
                        ? 'dropoffLongitude-error'
                        : undefined
                    }
                  />
                  {fieldErrors.dropoffLongitude ? (
                    <small id="dropoffLongitude-error" className="field-error">
                      {fieldErrors.dropoffLongitude}
                    </small>
                  ) : null}
                </div>
              </div>
            </fieldset>
            <label htmlFor="serviceType">Loại dịch vụ</label>
            <select
              id="serviceType"
              value={form.serviceType}
              onChange={(event) => setValue('serviceType', event.target.value)}
            >
              <option value="MOTORBIKE_STANDARD">Xe máy tiêu chuẩn</option>
              <option value="CAR_STANDARD">Ô tô tiêu chuẩn</option>
            </select>
            <p className="helper-copy">
              Bản đồ hiển thị pickup/dropoff. Tuyến đường và ETA chỉ là ước tính
              theo dữ liệu routing hiện có; cước cuối cùng được xác nhận khi
              chuyến hoàn tất.
            </p>
            <SubmitState
              state={quoteState}
              label={quote ? 'Lấy lại giá ước tính' : 'Xem giá ước tính'}
              disabled={currentTripState.state === 'submitting'}
              disabledLabel="Đang kiểm tra chuyến hiện tại…"
            />
          </form>
        ) : !trip && activeQuote ? (
          <article
            className="auth-card quote-card"
            aria-labelledby="quote-heading"
          >
            <div className="quote-kicker">
              <span className="planned-badge">Giá ước tính</span>
              <span>
                {activeQuote.serviceType === 'MOTORBIKE_STANDARD'
                  ? 'Xe máy tiêu chuẩn'
                  : 'Ô tô tiêu chuẩn'}
              </span>
            </div>
            <h2 id="quote-heading">
              {formatFare(activeQuote.totalFareMinor, activeQuote.currency)}
            </h2>
            <p className="quote-description">
              Giá này dùng snapshot của pricing rule và khoảng cách/thời lượng
              ước tính. Đây chưa phải cước cuối cùng.
            </p>
            <dl className="quote-details">
              <div>
                <dt>Điểm đón</dt>
                <dd>{activeQuote.pickup.label}</dd>
              </div>
              <div>
                <dt>Điểm đến</dt>
                <dd>{activeQuote.dropoff.label}</dd>
              </div>
              <div>
                <dt>Khoảng cách ước tính</dt>
                <dd>{formatDistance(activeQuote.estimatedDistanceMeters)}</dd>
              </div>
              <div>
                <dt>Nguồn ước tính</dt>
                <dd>
                  {activeQuote.route?.usedFallback
                    ? 'Tọa độ dự phòng'
                    : activeQuote.route
                      ? 'Dữ liệu đường'
                      : 'Phiên bản cũ'}
                </dd>
              </div>
              <div>
                <dt>Hết hạn lúc</dt>
                <dd>
                  {new Date(activeQuote.expiresAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </dd>
              </div>
            </dl>
            {quoteExpired ? (
              <p className="form-error" role="alert">
                Giá ước tính đã hết hạn. Hãy lấy lại giá trước khi đặt chuyến.
              </p>
            ) : (
              <p className="quote-expiry">
                Giá có hiệu lực đến{' '}
                {new Date(activeQuote.expiresAt).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}{' '}
                <span aria-hidden="true">
                  ({formatRemaining(activeQuote.expiresAt, now)})
                </span>
              </p>
            )}
            <div className="quote-actions">
              <button
                className="primary-link"
                type="button"
                disabled={quoteExpired || tripState.state === 'submitting'}
                onClick={handleTrip}
              >
                {tripState.state === 'submitting'
                  ? 'Đang ghi nhận yêu cầu…'
                  : 'Đặt chuyến'}{' '}
                <ArrowRight aria-hidden="true" size={20} weight="bold" />
              </button>
              <button
                className="secondary-link"
                type="button"
                onClick={editLocations}
              >
                Sửa điểm đi/đến
              </button>
            </div>
            {tripState.state === 'error' ? (
              <p className="form-error" role="alert">
                {tripState.message}
              </p>
            ) : null}
          </article>
        ) : null}
        {quoteState.state === 'error' && !quote ? (
          <p className="form-error standalone-error" role="alert">
            {quoteState.message}
          </p>
        ) : null}
        {currentTripState.state === 'error' && !trip && !quote ? (
          <div className="form-error standalone-error" role="alert">
            <p>Không thể khôi phục chuyến hiện tại. Bạn có thể thử lại ngay.</p>
            <span>{currentTripState.message}</span>
            <button
              className="secondary-link"
              type="button"
              onClick={() =>
                setCurrentTripRecoveryAttempt((attempt) => attempt + 1)
              }
            >
              Thử khôi phục lại
            </button>
          </div>
        ) : null}
        {currentTripState.state === 'submitting' && !trip && !quote ? (
          <p className="notice standalone-error" role="status">
            Đang kiểm tra chuyến hiện tại…
          </p>
        ) : null}
        {trip ? (
          <article
            className="auth-card trip-success"
            aria-labelledby="trip-result-heading"
          >
            <span className="success-icon">
              <CheckCircle aria-hidden="true" size={28} weight="fill" />
            </span>
            <p className="eyebrow">Đã ghi nhận yêu cầu</p>
            <h2 id="trip-result-heading">
              Chuyến đi đang ở trạng thái{' '}
              <code>{displayTripState(trip.state)}</code>.
            </h2>
            <p>{tripStateDescription(trip.state)}</p>
            <p
              className={`realtime-status realtime-status--${realtimeStatus}`}
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              <span aria-hidden="true" />
              {realtimeStatusLabel(realtimeStatus)}
            </p>
            <JourneyStatus kind="ride" state={trip.state} />
            {tripState.state === 'error' ? (
              <div className="form-error recovery-panel" role="alert">
                <p>{tripState.message}</p>
                <button
                  className="secondary-link"
                  type="button"
                  onClick={() => void retryMatching()}
                >
                  Thử tìm Tài xế lại
                </button>
              </div>
            ) : null}
            {quote ? (
              <div
                className="status-map"
                aria-label="Bản đồ trạng thái chuyến xe"
              >
                <LiveMapPreview
                  pickup={quote.pickup}
                  dropoff={quote.dropoff}
                  driver={
                    visibleDriverLocation
                      ? {
                          latitude: visibleDriverLocation.latitude,
                          longitude: visibleDriverLocation.longitude,
                          observedAt: visibleDriverLocation.receivedAt,
                        }
                      : null
                  }
                  route={quote.route}
                  kind="ride"
                />
                {visibleDriverLocation ? (
                  <p className="map-caption" role="status">
                    <NavigationArrow
                      aria-hidden="true"
                      size={16}
                      weight="fill"
                    />
                    {hasFreshDriverLocation && realtimeStatus === 'connected'
                      ? 'Vị trí Tài xế đang cập nhật; lần nhận gần nhất lúc '
                      : 'Vị trí gần nhất của Tài xế lúc '}
                    {new Date(
                      visibleDriverLocation.receivedAt,
                    ).toLocaleTimeString('vi-VN', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                ) : (
                  <p className="map-caption">
                    Chưa có vị trí Tài xế. Bản đồ vẫn hiển thị điểm đi và điểm
                    đến.
                  </p>
                )}
              </div>
            ) : null}
            <dl className="quote-details">
              <div>
                <dt>Mã chuyến</dt>
                <dd>{trip.id}</dd>
              </div>
              <div>
                <dt>Cước ước tính</dt>
                <dd>{formatFare(trip.quotedTotalFareMinor, trip.currency)}</dd>
              </div>
              <div>
                <dt>Phiên bản chuyến</dt>
                <dd>{trip.version}</dd>
              </div>
              {trip.finalFareMinor !== null ? (
                <div>
                  <dt>Cước cuối cùng</dt>
                  <dd>{formatFare(trip.finalFareMinor, trip.currency)}</dd>
                </div>
              ) : null}
              {trip.actualDistanceMeters !== null ? (
                <div>
                  <dt>Khoảng cách thực tế</dt>
                  <dd>{formatDistance(trip.actualDistanceMeters)}</dd>
                </div>
              ) : null}
            </dl>
            {dispatch?.offer && trip.state === 'MATCHING' ? (
              <p className="notice trip-offer-notice">
                Đang chờ Tài xế nhận chuyến. Trạng thái sẽ cập nhật khi lời mời
                được nhận, từ chối hoặc hết hạn.
              </p>
            ) : null}
            {cancellation ? (
              <p className="notice cancellation-status" aria-live="polite">
                Chuyến đi đã được hủy. Lý do:{' '}
                {cancellationReasonLabel(cancellation.reasonCode)}.
              </p>
            ) : null}
            {isCustomerCancellableTrip(trip.state) ? (
              <div className="cancellation-action">
                <button
                  className="danger-link"
                  type="button"
                  ref={cancellationTriggerRef}
                  onClick={openCancellationDialog}
                >
                  Hủy chuyến
                </button>
                <p>Chỉ nên hủy khi bạn không thể tiếp tục hành trình.</p>
              </div>
            ) : null}
            {trip.state === 'COMPLETED' ? (
              <div className="payment-panel" aria-live="polite">
                <p className="notice">
                  {payment
                    ? `Thanh toán ${displayPaymentStatus(payment.status)}${payment.providerReference ? ` · ${payment.providerReference}` : ''}.`
                    : 'Chuyến đã hoàn tất. Hãy ghi nhận thanh toán mô phỏng để đóng giao dịch.'}
                </p>
                {!payment ? (
                  <button
                    className="primary-link"
                    type="button"
                    disabled={paymentState.state === 'submitting'}
                    onClick={capturePayment}
                  >
                    {paymentState.state === 'submitting'
                      ? 'Đang ghi nhận thanh toán…'
                      : 'Ghi nhận thanh toán mô phỏng'}
                  </button>
                ) : null}
                {paymentState.state === 'error' ? (
                  <p className="form-error" role="alert">
                    {paymentState.message}
                  </p>
                ) : null}
              </div>
            ) : null}
            {isCancellationDialogOpen ? (
              <div className="cancellation-dialog-backdrop">
                <div
                  className="cancellation-dialog"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="cancel-trip-title"
                  aria-describedby="cancel-trip-description"
                  tabIndex={-1}
                  ref={cancellationDialogRef}
                >
                  {cancellation && trip.state === 'CANCELLED' ? (
                    <div className="cancellation-confirmed" role="status">
                      <span className="success-icon" aria-hidden="true">
                        <CheckCircle size={28} weight="fill" />
                      </span>
                      <p className="eyebrow">Đã hủy chuyến</p>
                      <h2 id="cancel-trip-title">
                        Yêu cầu hủy đã được ghi nhận.
                      </h2>
                      <p id="cancel-trip-description">
                        Chúng tôi đã cập nhật trạng thái chuyến đi của bạn.
                      </p>
                      <button
                        className="primary-link"
                        type="button"
                        onClick={closeCancellationDialog}
                      >
                        Đóng
                      </button>
                    </div>
                  ) : (
                    <form
                      onSubmit={submitCancellation}
                      noValidate
                      aria-busy={cancellationState.state === 'submitting'}
                    >
                      <p className="eyebrow">Xác nhận hủy chuyến</p>
                      <h2 id="cancel-trip-title">Bạn muốn hủy chuyến này?</h2>
                      <p id="cancel-trip-description">
                        Hành động này sẽ dừng yêu cầu tìm Tài xế hoặc chuyến đi
                        đang chờ đón. Hãy chọn một lý do trước khi xác nhận.
                      </p>
                      <fieldset className="cancellation-reasons">
                        <legend>Lý do hủy chuyến</legend>
                        {customerCancellationReasons.map((reason) => (
                          <label key={reason.code}>
                            <input
                              type="radio"
                              name="cancellationReason"
                              value={reason.code}
                              checked={cancellationReasonCode === reason.code}
                              disabled={
                                cancellationState.state === 'submitting'
                              }
                              onChange={() => {
                                setCancellationReasonCode(reason.code);
                                setCancellationState({ state: 'idle' });
                              }}
                            />
                            <span>{reason.label}</span>
                          </label>
                        ))}
                      </fieldset>
                      {cancellationReasonCode === 'OTHER' ? (
                        <div className="cancellation-detail">
                          <label htmlFor="cancellationReasonDetail">
                            Mô tả lý do khác
                          </label>
                          <textarea
                            id="cancellationReasonDetail"
                            rows={3}
                            maxLength={240}
                            value={cancellationReasonDetail}
                            disabled={cancellationState.state === 'submitting'}
                            aria-invalid={cancellationState.state === 'error'}
                            onChange={(event) => {
                              setCancellationReasonDetail(event.target.value);
                              setCancellationState({ state: 'idle' });
                            }}
                          />
                          <small>Tối thiểu 3 ký tự, tối đa 240 ký tự.</small>
                        </div>
                      ) : null}
                      {cancellationState.state === 'error' ? (
                        <p className="form-error" role="alert">
                          {cancellationState.message}
                        </p>
                      ) : null}
                      <div className="cancellation-actions">
                        <button
                          className="secondary-link"
                          type="button"
                          disabled={cancellationState.state === 'submitting'}
                          onClick={closeCancellationDialog}
                        >
                          Quay lại
                        </button>
                        <button
                          className="danger-button"
                          type="submit"
                          disabled={cancellationState.state === 'submitting'}
                        >
                          {cancellationState.state === 'submitting'
                            ? 'Đang hủy chuyến…'
                            : 'Xác nhận hủy chuyến'}
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              </div>
            ) : null}
            <button
              className="secondary-link"
              type="button"
              onClick={onAccount}
            >
              Về tài khoản
            </button>
          </article>
        ) : null}
      </div>
    </section>
  );
}

function validateDeliveryForm(
  form: DeliveryFormValues,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const coordinates: Array<
    [
      (
        | 'pickupLatitude'
        | 'pickupLongitude'
        | 'dropoffLatitude'
        | 'dropoffLongitude'
      ),
      string,
      number,
      number,
    ]
  > = [
    ['pickupLatitude', 'Vĩ độ điểm lấy hàng', -90, 90],
    ['pickupLongitude', 'Kinh độ điểm lấy hàng', -180, 180],
    ['dropoffLatitude', 'Vĩ độ điểm giao hàng', -90, 90],
    ['dropoffLongitude', 'Kinh độ điểm giao hàng', -180, 180],
  ];
  if (!form.pickupLabel.trim()) errors.pickupLabel = 'Nhập tên điểm đón.';
  if (!form.dropoffLabel.trim()) errors.dropoffLabel = 'Nhập tên điểm đến.';
  for (const [field, label, minimum, maximum] of coordinates) {
    const value = Number(form[field]);
    if (
      form[field].trim() === '' ||
      !Number.isFinite(value) ||
      value < minimum ||
      value > maximum
    )
      errors[field] =
        `${label} phải nằm trong khoảng ${minimum} đến ${maximum}.`;
  }
  if (
    !errors.pickupLatitude &&
    !errors.pickupLongitude &&
    !errors.dropoffLatitude &&
    !errors.dropoffLongitude &&
    Number(form.pickupLatitude) === Number(form.dropoffLatitude) &&
    Number(form.pickupLongitude) === Number(form.dropoffLongitude)
  )
    errors.dropoffLatitude = 'Điểm đón và điểm đến phải khác nhau.';
  if (!form.recipientDisplayName.trim())
    errors.recipientDisplayName = 'Nhập tên người nhận.';
  if (!/^\+?[0-9][0-9 -]{5,30}$/.test(form.recipientContactPhone.trim()))
    errors.recipientContactPhone = 'Nhập số điện thoại người nhận hợp lệ.';
  if (!form.parcelDescription.trim())
    errors.parcelDescription = 'Mô tả kiện hàng.';
  if (form.parcelDescription.trim().length > 280)
    errors.parcelDescription = 'Mô tả kiện hàng không được quá 280 ký tự.';
  const weight = Number(form.declaredWeightGrams);
  if (
    form.declaredWeightGrams.trim() === '' ||
    !Number.isInteger(weight) ||
    weight < 1 ||
    weight > 30_000
  )
    errors.declaredWeightGrams =
      'Khối lượng phải là số nguyên từ 1 đến 30000 gram.';
  return errors;
}

function validateRideForm(form: RideFormValues): Record<string, string> {
  const errors: Record<string, string> = {};
  const fields: Array<[keyof RideFormValues, string, number, number]> = [
    ['pickupLatitude', 'Vĩ độ điểm đón', -90, 90],
    ['pickupLongitude', 'Kinh độ điểm đón', -180, 180],
    ['dropoffLatitude', 'Vĩ độ điểm đến', -90, 90],
    ['dropoffLongitude', 'Kinh độ điểm đến', -180, 180],
  ];
  if (!form.pickupLabel.trim()) errors.pickupLabel = 'Nhập tên điểm đón.';
  if (!form.dropoffLabel.trim()) errors.dropoffLabel = 'Nhập tên điểm đến.';
  for (const [field, label, minimum, maximum] of fields) {
    const value = Number(form[field]);
    if (
      form[field].trim() === '' ||
      !Number.isFinite(value) ||
      value < minimum ||
      value > maximum
    )
      errors[field] =
        `${label} phải nằm trong khoảng ${minimum} đến ${maximum}.`;
  }
  if (
    !errors.pickupLatitude &&
    !errors.pickupLongitude &&
    !errors.dropoffLatitude &&
    !errors.dropoffLongitude &&
    Number(form.pickupLatitude) === Number(form.dropoffLatitude) &&
    Number(form.pickupLongitude) === Number(form.dropoffLongitude)
  )
    errors.dropoffLatitude = 'Điểm đón và điểm đến phải khác nhau.';
  return errors;
}

function formatFare(amount: number, currency: string): string {
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDistance(meters: number): string {
  return meters < 1000 ? `${meters} m` : `${(meters / 1000).toFixed(1)} km`;
}

function estimateCoordinateDistance(
  pickup: MapPoint,
  dropoff: MapPoint,
): number {
  const earthRadiusMeters = 6_371_000;
  const latitudeDelta = toRadians(dropoff.latitude - pickup.latitude);
  const longitudeDelta = toRadians(dropoff.longitude - pickup.longitude);
  const pickupLatitude = toRadians(pickup.latitude);
  const dropoffLatitude = toRadians(dropoff.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(pickupLatitude) *
      Math.cos(dropoffLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  return (
    earthRadiusMeters *
    2 *
    Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
  );
}

function estimateCoordinateDuration(
  pickup: MapPoint,
  dropoff: MapPoint,
): number {
  return Math.max(
    60,
    Math.ceil(estimateCoordinateDistance(pickup, dropoff) / 5),
  );
}

function formatDuration(seconds: number): string {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return minutes < 60
    ? `Khoảng ${minutes} phút`
    : `Khoảng ${Math.floor(minutes / 60)} giờ ${minutes % 60} phút`;
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function formatWeight(grams: number): string {
  return grams >= 1000 ? `${(grams / 1000).toFixed(2)} kg` : `${grams} g`;
}

function displayRole(role: string): string {
  return (
    (
      {
        CUSTOMER: 'Khách hàng',
        DRIVER: 'Tài xế',
        OPERATOR: 'Điều hành',
      } as Record<string, string>
    )[role] ?? role
  );
}

function displayTripState(state: string): string {
  return (
    (
      {
        CREATED: 'Đã tạo yêu cầu',
        MATCHING: 'Đang tìm Tài xế',
        ACCEPTED: 'Tài xế đã nhận chuyến',
        DRIVER_TO_PICKUP: 'Tài xế đang đến điểm đón',
        AT_PICKUP: 'Tài xế đã đến điểm đón',
        IN_PROGRESS: 'Đang di chuyển',
        COMPLETED: 'Đã hoàn tất',
        CANCELLED: 'Đã huỷ',
        NO_DRIVER_AVAILABLE: 'Chưa tìm thấy Tài xế',
        OFFER_EXPIRED: 'Lời mời đã hết hạn',
        FAILED: 'Xử lý không thành công',
      } as Record<string, string>
    )[state] ?? state.replaceAll('_', ' ')
  );
}

function displayDeliveryState(state: string): string {
  return (
    (
      {
        REQUESTED: 'Đã ghi nhận yêu cầu',
        MATCHING: 'Đang tìm Tài xế',
        DRIVER_TO_PICKUP: 'Tài xế đang đến điểm lấy hàng',
        AT_PICKUP: 'Tài xế đã đến điểm lấy hàng',
        IN_TRANSIT: 'Đang giao hàng',
        DELIVERED: 'Đã giao hàng',
        CANCELLED: 'Đã huỷ',
        NO_DRIVER_AVAILABLE: 'Chưa tìm thấy Tài xế',
      } as Record<string, string>
    )[state] ?? state.replaceAll('_', ' ')
  );
}

function displayWorkState(state: string): string {
  return (
    (
      {
        OFFLINE: 'Đang offline',
        AVAILABLE: 'Đang nhận chuyến',
        RESERVED: 'Đã giữ chỗ',
        TO_PICKUP: 'Đang đến điểm lấy/đón',
        ON_TRIP: 'Đang thực hiện chuyến',
      } as Record<string, string>
    )[state] ?? state.replaceAll('_', ' ')
  );
}

function displayPaymentStatus(status: string): string {
  return (
    (
      {
        PENDING: 'đang chờ',
        SUCCEEDED: 'thành công',
        FAILED: 'thất bại',
        CAPTURED: 'đã ghi nhận',
      } as Record<string, string>
    )[status] ?? status.toLowerCase()
  );
}

function isCustomerCancellableTrip(state: TripResponse['state']): boolean {
  return ['REQUESTED', 'MATCHING', 'DRIVER_TO_PICKUP', 'AT_PICKUP'].includes(
    state,
  );
}

function cancellationReasonLabel(reasonCode: CancellationReasonCode): string {
  return (
    customerCancellationReasons.find((reason) => reason.code === reasonCode)
      ?.label ?? reasonCode
  );
}

function deliveryStateDescription(state: DeliveryResponse['state']): string {
  switch (state) {
    case 'MATCHING':
      return 'Gove đang tìm một Tài xế phù hợp cho đơn hàng.';
    case 'DRIVER_TO_PICKUP':
      return 'Tài xế đã nhận đơn và đang đến điểm lấy hàng.';
    case 'AT_PICKUP':
      return 'Tài xế đã đến điểm lấy hàng.';
    case 'IN_TRANSIT':
      return 'Kiện hàng đã được xác nhận và đang trên đường giao.';
    case 'DELIVERED':
      return 'Đã ghi nhận việc giao hàng cho người nhận.';
    case 'NO_DRIVER_AVAILABLE':
      return 'Chưa tìm thấy Tài xế phù hợp trong lần tìm kiếm này.';
    default:
      return 'Yêu cầu gửi hàng đã được lưu vào hệ thống.';
  }
}

function toTripDetail(trip: TripResponse): TripDetailResponse {
  return {
    ...trip,
    driverId: null,
    actualDistanceMeters: null,
    actualDurationSeconds: null,
    finalFareMinor: null,
    completedAt: null,
  };
}

function tripStateDescription(state: TripResponse['state']): string {
  switch (state) {
    case 'MATCHING':
      return 'Gove đang tìm Tài xế phù hợp ở gần điểm đón.';
    case 'DRIVER_TO_PICKUP':
      return 'Tài xế đã nhận lời mời và đang đến điểm đón.';
    case 'NO_DRIVER_AVAILABLE':
      return 'Chưa tìm thấy Tài xế phù hợp trong khoảng thời gian này.';
    case 'COMPLETED':
      return 'Chuyến đi đã hoàn tất.';
    default:
      return 'Yêu cầu đã được lưu và trạng thái sẽ cập nhật trực tiếp.';
  }
}

function mergeRealtimeTrip(
  current: TripDetailResponse | null,
  next:
    | Partial<
        Pick<
          TripRealtimeSnapshot,
          | 'state'
          | 'version'
          | 'driverId'
          | 'actualDistanceMeters'
          | 'actualDurationSeconds'
          | 'finalFareMinor'
          | 'completedAt'
        >
      >
    | undefined,
): TripDetailResponse | null {
  if (!current || !next || !next.state || typeof next.version !== 'number')
    return current;
  if (next.version < current.version) return current;
  return {
    ...current,
    ...next,
    state: next.state,
    version: next.version,
  };
}

function mergeRealtimeTripEvent(
  current: TripDetailResponse | null,
  next:
    | Partial<
        Pick<
          TripRealtimeSnapshot,
          | 'state'
          | 'version'
          | 'driverId'
          | 'actualDistanceMeters'
          | 'actualDurationSeconds'
          | 'finalFareMinor'
          | 'completedAt'
        >
      >
    | undefined,
): TripDetailResponse | null {
  if (
    !current ||
    !next ||
    typeof next.version !== 'number' ||
    next.version <= current.version
  ) {
    return current;
  }
  return mergeRealtimeTrip(current, next);
}

function mergeRealtimeDelivery(
  current: DeliveryResponse | null,
  next:
    Partial<Pick<DeliveryRealtimeSnapshot, 'state' | 'version'>> | undefined,
): DeliveryResponse | null {
  if (!current || !next || !next.state || typeof next.version !== 'number')
    return current;
  if (next.version < current.version) return current;
  return { ...current, ...next, state: next.state, version: next.version };
}

function mergeRealtimeDeliveryEvent(
  current: DeliveryResponse | null,
  next:
    Partial<Pick<DeliveryRealtimeSnapshot, 'state' | 'version'>> | undefined,
): DeliveryResponse | null {
  if (
    !current ||
    !next ||
    typeof next.version !== 'number' ||
    next.version <= current.version
  ) {
    return current;
  }
  return mergeRealtimeDelivery(current, next);
}

function rememberRealtimeEvent(seen: Set<string>, eventId: string): boolean {
  if (seen.has(eventId)) return false;
  seen.add(eventId);
  if (seen.size > 256) {
    const oldest = seen.values().next().value as string | undefined;
    if (oldest) seen.delete(oldest);
  }
  return true;
}

function isNewerDriverLocation(
  current: DriverLocationSnapshot | DeliveryDriverLocation | null,
  next: DriverLocationSnapshot | DeliveryDriverLocation,
): boolean {
  if (!current) return true;
  const nextCapturedAt = Date.parse(next.capturedAt);
  const currentCapturedAt = Date.parse(current.capturedAt);
  if (!Number.isFinite(nextCapturedAt) || !Number.isFinite(currentCapturedAt)) {
    return false;
  }
  if (nextCapturedAt !== currentCapturedAt) {
    return nextCapturedAt > currentCapturedAt;
  }
  const nextReceivedAt = Date.parse(next.receivedAt);
  const currentReceivedAt = Date.parse(current.receivedAt);
  return (
    Number.isFinite(nextReceivedAt) &&
    Number.isFinite(currentReceivedAt) &&
    nextReceivedAt > currentReceivedAt
  );
}

function realtimeStatusLabel(
  status: 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error',
  aggregate = 'chuyến',
): string {
  switch (status) {
    case 'connecting':
      return `Đang kết nối trạng thái ${aggregate} trực tiếp…`;
    case 'connected':
      return `Đã kết nối trạng thái ${aggregate} trực tiếp`;
    case 'disconnected':
      return 'Mất kết nối cập nhật trực tiếp; đang thử kết nối lại';
    case 'error':
      return 'Cập nhật trực tiếp hiện không khả dụng';
    default:
      return `Cập nhật trực tiếp bắt đầu sau khi tạo ${aggregate}`;
  }
}

function formatRemaining(expiresAt: string, now: number): string {
  const seconds = Math.max(
    0,
    Math.ceil((new Date(expiresAt).getTime() - now) / 1000),
  );
  return `${Math.floor(seconds / 60)} phút ${seconds % 60} giây còn lại`;
}

function DriverSetupPage({
  actor,
  accessToken,
  onSignIn,
  onAccount,
}: {
  actor: AuthenticatedActor | null;
  accessToken: string | null;
  onSignIn: () => void;
  onAccount: () => void;
}) {
  const [state, setState] = useState<RequestState>({ state: 'idle' });
  const [saved, setSaved] = useState(false);
  if (!actor || !accessToken || !actor.roles.includes('DRIVER'))
    return <AccessRequired onSignIn={onSignIn} />;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setState({ state: 'submitting' });
    setSaved(false);
    const data = new FormData(event.currentTarget);
    const headers = { authorization: `Bearer ${accessToken}` };
    try {
      await request('/drivers/me/profile', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ phone: data.get('phone') }),
      });
      await request('/drivers/me/vehicles', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          vehicleClass: data.get('vehicleClass'),
          make: data.get('make'),
          model: data.get('model'),
          modelYear: Number(data.get('modelYear')),
          plate: data.get('plate'),
        }),
      });
      setState({ state: 'idle' });
      setSaved(true);
    } catch (error) {
      setState({ state: 'error', message: (error as Error).message });
    }
  };

  return (
    <section className="account-layout">
      <div className="account-heading">
        <p className="eyebrow">Khai báo Tài xế</p>
        <h1>Chuẩn bị hồ sơ để được duyệt.</h1>
        <p>
          Gửi thông tin chưa làm bạn online hoặc đủ điều kiện nhận chuyến. Đội
          ngũ điều hành vẫn cần duyệt hồ sơ.
        </p>
        <button className="back-link" type="button" onClick={onAccount}>
          <ArrowLeft aria-hidden="true" size={18} />
          Tài khoản
        </button>
      </div>
      <form
        className="auth-card driver-form"
        onSubmit={submit}
        aria-busy={state.state === 'submitting'}
      >
        <FormHeading
          title="Hồ sơ và phương tiện"
          subtitle="Bổ sung thông tin tối thiểu để đội ngũ điều hành xem xét."
        />
        <label htmlFor="phone">Số điện thoại</label>
        <input
          autoComplete="tel"
          id="phone"
          name="phone"
          type="tel"
          minLength={7}
          maxLength={32}
          required
        />
        <fieldset>
          <legend>Phương tiện</legend>
          <label htmlFor="vehicleClass">Loại phương tiện</label>
          <select
            id="vehicleClass"
            name="vehicleClass"
            defaultValue="MOTORBIKE"
          >
            <option value="MOTORBIKE">Xe máy</option>
            <option value="STANDARD_CAR">Ô tô tiêu chuẩn</option>
            <option value="PREMIUM_CAR">Ô tô cao cấp</option>
            <option value="VAN">Xe van</option>
          </select>
          <div className="form-grid">
            <div>
              <label htmlFor="make">Hãng xe</label>
              <input id="make" name="make" maxLength={80} required />
            </div>
            <div>
              <label htmlFor="model">Dòng xe</label>
              <input id="model" name="model" maxLength={80} required />
            </div>
          </div>
          <div className="form-grid">
            <div>
              <label htmlFor="modelYear">Năm sản xuất</label>
              <input
                id="modelYear"
                name="modelYear"
                type="number"
                min="1900"
                max="2100"
                required
              />
            </div>
            <div>
              <label htmlFor="plate">Biển số xe</label>
              <input
                id="plate"
                name="plate"
                minLength={3}
                maxLength={30}
                required
              />
            </div>
          </div>
        </fieldset>
        <SubmitState state={state} label="Lưu hồ sơ để duyệt" />
        {saved ? (
          <p className="success-message" role="status">
            Đã lưu hồ sơ. Tài khoản Tài xế đang chờ duyệt.
          </p>
        ) : null}
      </form>
    </section>
  );
}

function FormHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="form-heading">
      <h2>{title}</h2>
      <p>{subtitle}</p>
    </div>
  );
}

function SubmitState({
  state,
  label,
  disabled = false,
  disabledLabel,
}: {
  state: RequestState;
  label: string;
  disabled?: boolean;
  disabledLabel?: string;
}) {
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state.state === 'error') errorRef.current?.focus();
  }, [state]);

  return (
    <>
      <button
        className="primary-link submit-button"
        type="submit"
        disabled={state.state === 'submitting' || disabled}
        aria-busy={state.state === 'submitting' || disabled}
      >
        {state.state === 'submitting' || disabled ? (
          <>
            <span className="button-spinner" aria-hidden="true" />
            <span>
              {state.state === 'submitting'
                ? 'Đang xử lý…'
                : (disabledLabel ?? 'Đang kiểm tra…')}
            </span>
          </>
        ) : (
          <>
            {label}
            <ArrowRight aria-hidden="true" size={19} weight="bold" />
          </>
        )}
      </button>
      {state.state === 'error' ? (
        <div className="form-error" role="alert" tabIndex={-1} ref={errorRef}>
          <strong>Không thể hoàn tất yêu cầu.</strong>
          <span>{state.message}</span>
        </div>
      ) : null}
    </>
  );
}

function AccessRequired({ onSignIn }: { onSignIn: () => void }) {
  return (
    <section className="account-layout access-required">
      <p className="eyebrow">Khu vực bảo mật</p>
      <h1>Đăng nhập để tiếp tục.</h1>
      <p>Bạn cần đăng nhập để tiếp tục.</p>
      <button className="primary-link" type="button" onClick={onSignIn}>
        Đăng nhập <ArrowRight aria-hidden="true" size={20} weight="bold" />
      </button>
    </section>
  );
}
