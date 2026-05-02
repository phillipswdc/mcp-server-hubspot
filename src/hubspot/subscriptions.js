/**
 * Subscription-domain wrapper methods. Read-only — subscriptions are created
 * by billing systems and observed via this API.
 *
 * Uses the generic objects API.
 */
import {
  makeShapeFn,
  getGenericObjectById,
  searchGenericObject,
  listAssociatedGenericObjects,
} from "./_generic_object.js";
import { DEFAULT_SUBSCRIPTION_PROPERTIES } from "../config/constants.js";

const OBJ = "subscriptions";
const SHAPE = makeShapeFn(OBJ);

export async function getSubscriptionById(subscriptionId, properties) {
  return await getGenericObjectById(
    OBJ,
    subscriptionId,
    properties ?? [...DEFAULT_SUBSCRIPTION_PROPERTIES],
    SHAPE
  );
}

export async function searchSubscriptions(input) {
  return await searchGenericObject(
    OBJ,
    input,
    DEFAULT_SUBSCRIPTION_PROPERTIES,
    SHAPE,
    "search_subscriptions"
  );
}

const FOR = (parent) => async (parentId, options) =>
  listAssociatedGenericObjects({
    sourceType: parent,
    sourceId: parentId,
    targetType: OBJ,
    defaultProperties: DEFAULT_SUBSCRIPTION_PROPERTIES,
    shape: SHAPE,
    options,
  });

export const listSubscriptionsForContact = FOR("contacts");
export const listSubscriptionsForCompany = FOR("companies");
