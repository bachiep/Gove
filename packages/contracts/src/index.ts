export interface HealthResponse {
  service: 'gove-api';
  status: 'ok';
  timestamp: string;
}

export interface ReadinessResponse extends HealthResponse {
  dependencies: {
    postgres: 'ready';
    postgis: string;
  };
}
