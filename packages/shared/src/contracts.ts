export type Id = string;

export type Locale = 'en' | 'id';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/** Respons publik health; tidak memuat path, konfigurasi atau secret host. */
export interface HealthStatus {
  status: 'ok';
  hostId: Id;
}
