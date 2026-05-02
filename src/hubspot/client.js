/**
 * HubSpot SDK client instance. Holds the singleton `Client` so other modules
 * don't each construct their own. Token comes from src/config/env.js, which
 * resolves against the active HUBSPOT_ENV.
 */
import { Client } from "@hubspot/api-client";
import { env } from "../config/env.js";

/** Pre-authenticated HubSpot SDK client for the active environment. */
export const sdk = new Client({ accessToken: env.token });
