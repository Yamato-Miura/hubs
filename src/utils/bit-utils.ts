import { Component, defineQuery, hasComponent } from "bitecs";
import { HubsWorld } from "../app";
import { findAncestor } from "./three-utils";

const queries = new Map();
export function anyEntityWith(world: HubsWorld, component: Component) {
  if (!queries.has(component)) {
    queries.set(component, defineQuery([component]));
  }

  const eids = queries.get(component)(world);
  return eids.length && eids[0];
}

export function hasAnyComponent(world: HubsWorld, components: Component[], eid: number) {
  for (let i = 0; i < components.length; i++) {
    if (hasComponent(world, components[i], eid)) return true;
  }
  return false;
}

export function findAncestorEntity(world: HubsWorld, eid: number, predicate: (eid: number) => boolean) {
  const obj = findAncestor(world.eid2obj.get(eid)!, o => !!(o.eid && predicate(o.eid)));
  return obj && obj.eid!;
}

export function findAncestorWithComponent(world: HubsWorld, component: Component, eid: number) {
  return findAncestorEntity(world, eid, otherId => hasComponent(world, component, otherId));
}
