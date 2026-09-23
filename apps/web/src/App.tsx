import type { ReadinessResponse } from '@gove/contracts';
import {
  ArrowRight,
  Broadcast,
  CarProfile,
  CheckCircle,
  MapPin,
  ShieldCheck,
  SteeringWheel,
  UserCircle,
} from '@phosphor-icons/react';
import { useEffect, useState } from 'react';

type ApiState =
  | { status: 'checking' }
  | { status: 'ready'; details: ReadinessResponse }
  | { status: 'unavailable' };

const roles = [
  {
    icon: UserCircle,
    label: 'Customer',
    description: 'Request a ride and follow every meaningful update.',
  },
  {
    icon: SteeringWheel,
    label: 'Driver',
    description: 'Control availability, offers, and the active trip.',
  },
  {
    icon: Broadcast,
    label: 'Operations',
    description: 'Trace health, exceptions, and the trip timeline.',
  },
] as const;

export function App() {
  const [api, setApi] = useState<ApiState>({ status: 'checking' });

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

  const apiLabel =
    api.status === 'checking'
      ? 'Checking platform'
      : api.status === 'ready'
        ? 'Foundation online'
        : 'Foundation unavailable';

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Gove home">
          <span className="brand-mark" aria-hidden="true">
            G
          </span>
          <span>Gove</span>
        </a>
        <a className="status-link" href="#platform-status">
          <span className={`status-dot status-dot--${api.status}`} />
          {apiLabel}
        </a>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">Real-time urban mobility</p>
          <h1>Every ride, clear from request to arrival.</h1>
          <p className="hero-description">
            Gove is building one reliable journey for riders, drivers, and
            operators, with live status that says exactly what is happening.
          </p>
          <a className="primary-link" href="#journey">
            Explore the journey
            <ArrowRight aria-hidden="true" size={20} weight="bold" />
          </a>
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
              <span className="role-state">Planned for the ride slice</span>
            </article>
          ))}
        </div>
      </section>

      <section
        className="journey"
        id="journey"
        aria-labelledby="journey-heading"
      >
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

      <section
        className="platform-status"
        id="platform-status"
        aria-labelledby="status-heading"
      >
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
