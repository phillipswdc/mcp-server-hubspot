/**
 * Payment-domain wrapper methods. Read-only — payments are recorded by
 * payment processors and observed via this API.
 *
 * Uses the generic objects API.
 */
import {
  makeShapeFn,
  getGenericObjectById,
  searchGenericObject,
  listAssociatedGenericObjects,
} from "./_generic_object.js";
import { DEFAULT_PAYMENT_PROPERTIES } from "../config/constants.js";

const OBJ = "payments";
const SHAPE = makeShapeFn(OBJ);

export async function getPaymentById(paymentId, properties) {
  return await getGenericObjectById(
    OBJ,
    paymentId,
    properties ?? [...DEFAULT_PAYMENT_PROPERTIES],
    SHAPE
  );
}

export async function searchPayments(input) {
  return await searchGenericObject(OBJ, input, DEFAULT_PAYMENT_PROPERTIES, SHAPE, "search_payments");
}

const FOR = (parent) => async (parentId, options) =>
  listAssociatedGenericObjects({
    sourceType: parent,
    sourceId: parentId,
    targetType: OBJ,
    defaultProperties: DEFAULT_PAYMENT_PROPERTIES,
    shape: SHAPE,
    options,
  });

export const listPaymentsForContact = FOR("contacts");
export const listPaymentsForCompany = FOR("companies");
