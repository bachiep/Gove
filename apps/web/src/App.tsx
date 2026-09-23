import type {
  ApiErrorResponse,
  AuthenticatedActor,
  AuthenticationResponse,
  ReadinessResponse,
  RegistrationResponse,
} from '@gove/contracts';
import {
  ArrowLeft,
  ArrowRight,
  Broadcast,
  CarProfile,
  CheckCircle,
  MapPin,
  ShieldCheck,
  SignOut,
  SteeringWheel,
  UserCircle,
} from '@phosphor-icons/react';
import { type FormEvent, useEffect, useRef, useState } from 'react';

type ApiState =
  | { status: 'checking' }
  | { status: 'ready'; details: ReadinessResponse }
  | { status: 'unavailable' };
type Page = 'home' | 'register' | 'sign-in' | 'account' | 'driver-setup';
type RequestState =
  | { state: 'idle' }
  | { state: 'submitting' }
  | { state: 'error'; message: string };

const roles = [
  {
    icon: UserCircle,
    label: 'Customer',
    description: 'Request a ride and follow every meaningful update.',
  },
  {
    icon: SteeringWheel,
    label: 'Driver',
    description: 'Set up a profile and vehicle before operational review.',
  },
  {
    icon: Broadcast,
    label: 'Operations',
    description: 'Trace health, exceptions, and the trip timeline.',
  },
] as const;

function pageFromLocation(): Page {
  const path = window.location.pathname;
  if (path === '/register') return 'register';
  if (path === '/sign-in') return 'sign-in';
  if (path === '/account') return 'account';
  if (path === '/driver/setup') return 'driver-setup';
  return 'home';
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    ...options,
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...options.headers },
  });
  if (!response.ok) {
    const fallback = 'Something went wrong. Please try again.';
    const error = (await response
      .json()
      .catch(() => null)) as ApiErrorResponse | null;
    throw new Error(error?.message ?? fallback);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function App() {
  const [api, setApi] = useState<ApiState>({ status: 'checking' });
  const [page, setPage] = useState<Page>(pageFromLocation);
  const [actor, setActor] = useState<AuthenticatedActor | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);

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
    const onPopState = () => setPage(pageFromLocation());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = (next: Page) => {
    const path: Record<Page, string> = {
      home: '/',
      register: '/register',
      'sign-in': '/sign-in',
      account: '/account',
      'driver-setup': '/driver/setup',
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
      ? 'Checking platform'
      : api.status === 'ready'
        ? 'Foundation online'
        : 'Foundation unavailable';

  if (page !== 'home') {
    return (
      <main className="account-shell">
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
            onSignIn={() => navigate('sign-in')}
            onDriverSetup={() => navigate('driver-setup')}
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
      </main>
    );
  }

  return (
    <main>
      <AppHeader
        api={api}
        apiLabel={apiLabel}
        actor={actor}
        onHome={() => navigate('home')}
        onSignOut={signOut}
      />
      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">Real-time urban mobility</p>
          <h1>Every ride, clear from request to arrival.</h1>
          <p className="hero-description">
            Gove is building one reliable journey for riders, drivers, and
            operators, with live status that says exactly what is happening.
          </p>
          <div className="hero-actions">
            <button
              className="primary-link"
              type="button"
              onClick={() => navigate(actor ? 'account' : 'register')}
            >
              {actor ? 'Open account' : 'Create an account'}
              <ArrowRight aria-hidden="true" size={20} weight="bold" />
            </button>
            {!actor ? (
              <button
                className="secondary-link"
                type="button"
                onClick={() => navigate('sign-in')}
              >
                Sign in
              </button>
            ) : null}
          </div>
        </div>
        <div className="route-card" aria-label="Planned ride journey preview">
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
              <span className="summary-label">MVP route</span>
              <strong>One complete ride</strong>
            </div>
            <span className="planned-badge">In progress</span>
          </div>
        </div>
      </section>
      <section className="roles" aria-labelledby="roles-heading">
        <div className="section-heading">
          <p className="eyebrow">Built around people</p>
          <h2 id="roles-heading">One platform, three focused views</h2>
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
                {label === 'Driver'
                  ? 'Account setup available'
                  : 'Planned for the ride slice'}
              </span>
            </article>
          ))}
        </div>
      </section>
      <section className="journey" aria-labelledby="journey-heading">
        <div className="section-heading section-heading--light">
          <p className="eyebrow">First vertical slice</p>
          <h2 id="journey-heading">A journey with no hidden state</h2>
        </div>
        <ol className="journey-list">
          {[
            ['01', 'Request', 'Customer confirms pickup, dropoff, and quote.'],
            [
              '02',
              'Match',
              'The platform reserves one eligible nearby driver.',
            ],
            ['03', 'Ride', 'Both sides receive authoritative live status.'],
            ['04', 'Settle', 'The final fare closes with simulated payment.'],
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
          <p className="eyebrow">Live foundation status</p>
          <h2 id="status-heading">Infrastructure you can verify</h2>
          <p className="status-copy">
            This panel reads the API readiness endpoint. It reports success only
            after PostgreSQL and PostGIS answer a real query.
          </p>
        </div>
        <div className={`health-card health-card--${api.status}`} role="status">
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
                  ? 'Waiting for a readiness response'
                  : 'Start the local API and database to connect'}
            </span>
          </div>
        </div>
      </section>
      <footer>
        <span>Gove</span>
        <span>Designed for measurable, dependable mobility.</span>
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
  return (
    <header className="topbar">
      <button
        className="brand"
        type="button"
        onClick={onHome}
        aria-label="Gove home"
      >
        <span className="brand-mark" aria-hidden="true">
          G
        </span>
        <span>Gove</span>
      </button>
      <div className="header-actions">
        <span className="status-link">
          <span className={`status-dot status-dot--${api.status}`} />
          {apiLabel}
        </span>
        {actor ? (
          <button className="text-button" type="button" onClick={onSignOut}>
            <SignOut aria-hidden="true" size={18} />
            Sign out
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
          role: data.get('role'),
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
        <p className="eyebrow">Account foundation</p>
        <h1>Create your Gove account.</h1>
        <p>
          Choose Customer to prepare for booking, or Driver to provide a profile
          and vehicle for review. Driver accounts are not eligible for matching
          until approval.
        </p>
      </div>
      <form className="auth-card" onSubmit={submit}>
        <FormHeading
          title="Create account"
          subtitle="Use an email address you control."
        />
        <label htmlFor="displayName">Full name</label>
        <input
          autoComplete="name"
          id="displayName"
          name="displayName"
          required
          maxLength={120}
        />
        <label htmlFor="email">Email address</label>
        <input
          autoComplete="email"
          id="email"
          name="email"
          type="email"
          required
        />
        <label htmlFor="password">Password</label>
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
          At least 12 characters. Password managers and paste are supported.
        </small>
        <fieldset>
          <legend>Account type</legend>
          <div className="choice-row">
            <label>
              <input defaultChecked name="role" type="radio" value="CUSTOMER" />{' '}
              Customer
            </label>
            <label>
              <input name="role" type="radio" value="DRIVER" /> Driver
            </label>
          </div>
        </fieldset>
        <SubmitState state={state} label="Create account" />
        <p className="form-footer">
          Already registered?{' '}
          <button type="button" className="inline-button" onClick={onSignIn}>
            Sign in
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
        <p className="eyebrow">Welcome back</p>
        <h1>Continue with a protected session.</h1>
        <p>
          Your refresh token stays in an HttpOnly cookie. The page keeps the
          short-lived access token only in memory.
        </p>
      </div>
      <form className="auth-card" onSubmit={submit}>
        <FormHeading
          title="Sign in"
          subtitle="Enter the account details you registered."
        />
        <label htmlFor="login-email">Email address</label>
        <input
          autoComplete="email"
          id="login-email"
          name="email"
          type="email"
          required
        />
        <label htmlFor="login-password">Password</label>
        <input
          autoComplete="current-password"
          id="login-password"
          name="password"
          type="password"
          required
        />
        <SubmitState state={state} label="Sign in" />
        <p className="form-footer">
          Need an account?{' '}
          <button type="button" className="inline-button" onClick={onRegister}>
            Create one
          </button>
        </p>
      </form>
    </section>
  );
}

function AccountPage({
  actor,
  onSignIn,
  onDriverSetup,
}: {
  actor: AuthenticatedActor | null;
  onSignIn: () => void;
  onDriverSetup: () => void;
}) {
  if (!actor) return <AccessRequired onSignIn={onSignIn} />;
  return (
    <section className="account-layout">
      <div className="account-heading">
        <p className="eyebrow">Authenticated account</p>
        <h1>Welcome, {actor.displayName}.</h1>
        <p>
          This account foundation establishes identity and an explicit session
          before the ride flow is introduced.
        </p>
      </div>
      <article className="account-card">
        <dl>
          <div>
            <dt>Email</dt>
            <dd>{actor.email}</dd>
          </div>
          <div>
            <dt>Roles</dt>
            <dd>{actor.roles.map((role) => role.toLowerCase()).join(', ')}</dd>
          </div>
        </dl>
        {actor.roles.includes('DRIVER') ? (
          <button
            className="primary-link"
            type="button"
            onClick={onDriverSetup}
          >
            Complete driver setup{' '}
            <ArrowRight aria-hidden="true" size={20} weight="bold" />
          </button>
        ) : (
          <p className="notice">
            Ride requests are part of the next vertical slice. This customer
            identity is ready for that boundary.
          </p>
        )}
      </article>
    </section>
  );
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
        <p className="eyebrow">Driver onboarding</p>
        <h1>Prepare your profile for review.</h1>
        <p>
          Submitting these details does not put you online or make you eligible
          for dispatch. Operations approval is still required.
        </p>
        <button className="back-link" type="button" onClick={onAccount}>
          <ArrowLeft aria-hidden="true" size={18} />
          Account
        </button>
      </div>
      <form className="auth-card driver-form" onSubmit={submit}>
        <FormHeading
          title="Profile and vehicle"
          subtitle="Add the minimum information required for an approval review."
        />
        <label htmlFor="phone">Phone number</label>
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
          <legend>Vehicle</legend>
          <label htmlFor="vehicleClass">Service class</label>
          <select
            id="vehicleClass"
            name="vehicleClass"
            defaultValue="MOTORBIKE"
          >
            <option value="MOTORBIKE">Motorbike</option>
            <option value="STANDARD_CAR">Standard car</option>
            <option value="PREMIUM_CAR">Premium car</option>
            <option value="VAN">Van</option>
          </select>
          <div className="form-grid">
            <div>
              <label htmlFor="make">Make</label>
              <input id="make" name="make" maxLength={80} required />
            </div>
            <div>
              <label htmlFor="model">Model</label>
              <input id="model" name="model" maxLength={80} required />
            </div>
          </div>
          <div className="form-grid">
            <div>
              <label htmlFor="modelYear">Model year</label>
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
              <label htmlFor="plate">Plate number</label>
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
        <SubmitState state={state} label="Save for review" />
        {saved ? (
          <p className="success-message" role="status">
            Profile saved. Your driver account remains pending review.
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

function SubmitState({ state, label }: { state: RequestState; label: string }) {
  return (
    <>
      <button
        className="primary-link submit-button"
        type="submit"
        disabled={state.state === 'submitting'}
      >
        {state.state === 'submitting' ? 'Please wait…' : label}
      </button>
      {state.state === 'error' ? (
        <p className="form-error" role="alert">
          {state.message}
        </p>
      ) : null}
    </>
  );
}

function AccessRequired({ onSignIn }: { onSignIn: () => void }) {
  return (
    <section className="account-layout access-required">
      <p className="eyebrow">Protected area</p>
      <h1>Sign in to continue.</h1>
      <p>A valid short-lived access token is required for this page.</p>
      <button className="primary-link" type="button" onClick={onSignIn}>
        Sign in <ArrowRight aria-hidden="true" size={20} weight="bold" />
      </button>
    </section>
  );
}
