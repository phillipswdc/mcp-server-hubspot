/**
 * Cart-domain wrapper methods. Read-only — carts are written by ecommerce
 * front-ends and observed via this API.
 *
 * Uses the generic objects API.
 */
import {
  makeShapeFn,
  getGenericObjectById,
  searchGenericObject,
  listAssociatedGenericObjects,
} from "./_generic_object.js";
import { DEFAULT_CART_PROPERTIES } from "../config/constants.js";

const OBJ = "carts";
const SHAPE = makeShapeFn(OBJ);

export async function getCartById(cartId, properties) {
  return await getGenericObjectById(
    OBJ,
    cartId,
    properties ?? [...DEFAULT_CART_PROPERTIES],
    SHAPE
  );
}

export async function searchCarts(input) {
  return await searchGenericObject(OBJ, input, DEFAULT_CART_PROPERTIES, SHAPE, "search_carts");
}

export async function listCartsForContact(contactId, options) {
  return await listAssociatedGenericObjects({
    sourceType: "contacts",
    sourceId: contactId,
    targetType: OBJ,
    defaultProperties: DEFAULT_CART_PROPERTIES,
    shape: SHAPE,
    options,
  });
}
