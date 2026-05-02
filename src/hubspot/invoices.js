/**
 * Invoice-domain wrapper methods. Read-only — invoices come from accounting
 * integrations or HubSpot's billing flows, not via API mutation here.
 *
 * Uses the generic objects API since invoices don't have a dedicated SDK
 * module like contacts does.
 */
import {
  makeShapeFn,
  getGenericObjectById,
  searchGenericObject,
  listAssociatedGenericObjects,
} from "./_generic_object.js";
import { DEFAULT_INVOICE_PROPERTIES } from "../config/constants.js";

const OBJ = "invoices";
const SHAPE = makeShapeFn(OBJ);

/** Look up an invoice by HubSpot internal ID. */
export async function getInvoiceById(invoiceId, properties) {
  return await getGenericObjectById(
    OBJ,
    invoiceId,
    properties ?? [...DEFAULT_INVOICE_PROPERTIES],
    SHAPE
  );
}

/** Search invoices by query and/or property filters. */
export async function searchInvoices(input) {
  return await searchGenericObject(OBJ, input, DEFAULT_INVOICE_PROPERTIES, SHAPE, "search_invoices");
}

const FOR = (parent) => async (parentId, options) =>
  listAssociatedGenericObjects({
    sourceType: parent,
    sourceId: parentId,
    targetType: OBJ,
    defaultProperties: DEFAULT_INVOICE_PROPERTIES,
    shape: SHAPE,
    options,
  });

export const listInvoicesForContact = FOR("contacts");
export const listInvoicesForCompany = FOR("companies");
