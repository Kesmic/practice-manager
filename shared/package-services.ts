/**
 * The firm's services, what each package includes of them, and what a client gets on
 * top of their package.
 *
 * A service is "Tax services"; a sub-service is "VAT & levies" under it. A package
 * includes some of each. A client on one package can be given a service or
 * sub-service that belongs to a higher one - an extra - and the whole point of this
 * module is that both sides can see that plainly: the firm on the client's record, and
 * the client on their own page, with the extra marked and named for the package it
 * comes from.
 *
 * Imported by both the Worker and the browser, so the two cannot disagree about what a
 * package includes or where an extra came from.
 */

import { TIER_LABELS, TIER_ORDER, tierRank, type ClientTier } from "./subscriptions";

export interface PackageService {
  id: string;
  name: string;
  parent_id: string | null;
  position: number;
  active: 0 | 1;
}

export interface ServiceInclusion {
  tier: ClientTier;
  service_id: string;
  /** How often, or at what depth, this package gets it: "monthly", "weekly", "full IFRS". */
  note?: string | null;
}

/** One branch of the tree a screen draws: a service, with its sub-services under it. */
export interface ServiceBranch {
  id: string;
  name: string;
  /** Given on top of the package rather than part of it. */
  extra: boolean;
  /** Where an extra comes from: the cheapest package that includes it. */
  from: ClientTier | null;
  /** The note on the inclusion this client gets - their package's, or the extra's source. */
  note: string | null;
  children: Array<{
    id: string;
    name: string;
    extra: boolean;
    from: ClientTier | null;
    note: string | null;
  }>;
}

/** The note a package puts on a service, if any. */
export function inclusionNote(
  tier: ClientTier | null,
  serviceId: string,
  inclusions: ServiceInclusion[],
): string | null {
  if (!tier) return null;
  const row = inclusions.find((i) => i.tier === tier && i.service_id === serviceId);
  return row?.note?.trim() || null;
}

/** The live services, as parents with their children in order. */
export function serviceTree(
  services: PackageService[],
): Array<PackageService & { children: PackageService[] }> {
  const live = services.filter((s) => s.active === 1);
  return live
    .filter((s) => !s.parent_id)
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
    .map((top) => ({
      ...top,
      children: live
        .filter((s) => s.parent_id === top.id)
        .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name)),
    }));
}

/**
 * Everything a package includes, as a set of service ids - the ones chosen for it,
 * plus the parent of any chosen sub-service, because "VAT & levies" is included under
 * "Tax services" and the heading comes with it.
 */
export function includedIn(
  tier: ClientTier,
  inclusions: ServiceInclusion[],
  services: PackageService[],
): Set<string> {
  const byId = new Map(services.map((s) => [s.id, s]));
  const chosen = new Set(inclusions.filter((i) => i.tier === tier).map((i) => i.service_id));
  for (const id of [...chosen]) {
    const parent = byId.get(id)?.parent_id;
    if (parent) chosen.add(parent);
  }
  return chosen;
}

/** The cheapest package that includes a service, or null if none does. */
export function cheapestPackageWith(
  serviceId: string,
  inclusions: ServiceInclusion[],
): ClientTier | null {
  const tiers = inclusions.filter((i) => i.service_id === serviceId).map((i) => i.tier);
  if (!tiers.length) return null;
  return [...tiers].sort((a, b) => tierRank(a) - tierRank(b))[0];
}

/**
 * What a client actually gets, drawn as one tree: their package's services, with any
 * extras slotted in where they belong and marked as extras.
 *
 * An extra sub-service goes under its own service even when the package does not
 * include that service - the heading appears for the extra's sake, unmarked, because
 * it is only a heading. An extra service goes in as a branch of its own.
 */
export function includedTree(input: {
  tier: ClientTier;
  services: PackageService[];
  inclusions: ServiceInclusion[];
  extras: Array<{ service_id: string }>;
}): ServiceBranch[] {
  const included = includedIn(input.tier, input.inclusions, input.services);
  const extraIds = new Set(input.extras.map((e) => e.service_id));
  const from = (id: string) => cheapestPackageWith(id, input.inclusions);
  const branches: ServiceBranch[] = [];

  const note = (id: string, extra: boolean) =>
    inclusionNote(extra ? from(id) : input.tier, id, input.inclusions);
  for (const top of serviceTree(input.services)) {
    const topIn = included.has(top.id);
    const topExtra = !topIn && extraIds.has(top.id);
    const children = top.children
      .filter((c) => included.has(c.id) || extraIds.has(c.id))
      .map((c) => ({
        id: c.id,
        name: c.name,
        extra: !included.has(c.id),
        from: !included.has(c.id) ? from(c.id) : null,
        note: note(c.id, !included.has(c.id)),
      }));
    if (!topIn && !topExtra && children.length === 0) continue;
    branches.push({
      id: top.id,
      name: top.name,
      extra: topExtra,
      from: topExtra ? from(top.id) : null,
      note: note(top.id, topExtra),
      children,
    });
  }
  return branches;
}

/**
 * The services a client on this package could be given as an extra: everything live
 * that the package does not already include, each named for the package it belongs to.
 */
export function extraCandidates(input: {
  tier: ClientTier;
  services: PackageService[];
  inclusions: ServiceInclusion[];
  /** Extras they already have, which are not offered twice. */
  extras: Array<{ service_id: string }>;
}): Array<{ id: string; label: string; from: ClientTier | null }> {
  const included = includedIn(input.tier, input.inclusions, input.services);
  const have = new Set(input.extras.map((e) => e.service_id));
  const out: Array<{ id: string; label: string; from: ClientTier | null }> = [];
  for (const top of serviceTree(input.services)) {
    if (!included.has(top.id) && !have.has(top.id)) {
      out.push({ id: top.id, label: top.name, from: cheapestPackageWith(top.id, input.inclusions) });
    }
    for (const c of top.children) {
      if (!included.has(c.id) && !have.has(c.id)) {
        out.push({
          id: c.id,
          label: `${top.name} · ${c.name}`,
          from: cheapestPackageWith(c.id, input.inclusions),
        });
      }
    }
  }
  return out;
}

/** "From Growth", or "Not in any package" for something the firm only gives one-to-one. */
export function describeSource(from: ClientTier | null): string {
  return from ? `From ${TIER_LABELS[from]}` : "Not in any package";
}

/** The packages in order, for a matrix of checkboxes. */
export const PACKAGE_COLUMNS: ClientTier[] = [...TIER_ORDER];

// ---------------------------------------------------------------------------
// Refusals, worded once so the form and the server say the same thing
// ---------------------------------------------------------------------------

export function whyNotAServiceName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Give the service a name.";
  if (trimmed.length > 120) return "That name is too long - keep it under 120 characters.";
  return null;
}

/** Why this cannot be given to this client as an extra, or null. */
export function whyNotAnExtra(input: {
  tier: ClientTier;
  serviceId: string;
  services: PackageService[];
  inclusions: ServiceInclusion[];
  extras: Array<{ service_id: string }>;
}): string | null {
  const service = input.services.find((s) => s.id === input.serviceId);
  if (!service) return "There is no such service.";
  if (service.active !== 1) return "That service has been retired.";
  if (includedIn(input.tier, input.inclusions, input.services).has(input.serviceId)) {
    return `${service.name} is already part of ${TIER_LABELS[input.tier]}.`;
  }
  if (input.extras.some((e) => e.service_id === input.serviceId)) {
    return `${service.name} is already an extra for this client.`;
  }
  return null;
}
