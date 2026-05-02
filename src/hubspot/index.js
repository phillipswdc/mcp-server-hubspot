/**
 * Public namespace for HubSpot domain operations. Tools should import from
 * here, not from individual files — keeps tool code stable when internal
 * layout changes.
 */
import { SUPPORTED_OBJECT_TYPES } from "../config/constants.js";
import {
  getContactById,
  getContactByEmail,
  searchContacts,
  listRecentContacts,
  updateContact,
  createContact,
} from "./contacts.js";
import { listProperties, getProperty } from "./properties.js";
import {
  getCompanyById,
  getCompanyByDomain,
  searchCompanies,
  updateCompany,
  createCompany,
} from "./companies.js";
import {
  getDealById,
  searchDeals,
  listDealsForCompany,
  listDealsForContact,
  updateDeal,
  createDeal,
} from "./deals.js";
import {
  getTicketById,
  searchTickets,
  listTicketsForContact,
  listTicketsForCompany,
  updateTicket,
  createTicket,
} from "./tickets.js";
import {
  rollbackChange,
  listRecentChanges,
  getChangeDetail,
  pruneAuditLog,
} from "./audit.js";
import { env } from "../config/env.js";
import { dbPath } from "../db/index.js";

/** Public domain API consumed by MCP tool handlers. */
export const hubspot = {
  /** @returns {readonly string[]} Supported HubSpot object types. */
  supportedObjectTypes: () => [...SUPPORTED_OBJECT_TYPES],

  /** @returns {{ name: string, isProduction: boolean, isSandbox: boolean, db_path: string }} */
  environment: () => ({
    name: env.name,
    isProduction: env.isProduction,
    isSandbox: env.isSandbox,
    db_path: dbPath,
  }),

  // Property introspection
  listProperties,
  getProperty,

  // Contacts
  getContactById,
  getContactByEmail,
  searchContacts,
  listRecentContacts,
  updateContact,
  createContact,

  // Companies
  getCompanyById,
  getCompanyByDomain,
  searchCompanies,
  updateCompany,
  createCompany,

  // Deals
  getDealById,
  searchDeals,
  listDealsForCompany,
  listDealsForContact,
  updateDeal,
  createDeal,

  // Tickets
  getTicketById,
  searchTickets,
  listTicketsForContact,
  listTicketsForCompany,
  updateTicket,
  createTicket,

  // Audit + rollback
  rollbackChange,
  listRecentChanges,
  getChangeDetail,
  pruneAuditLog,
};
