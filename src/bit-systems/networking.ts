import {
  addComponent,
  Component,
  defineQuery,
  enterQuery,
  exitQuery,
  hasComponent,
  removeComponent,
  removeEntity
} from "bitecs";
import { HubsWorld } from "../app";
import {
  AEntity,
  Networked,
  NetworkedMediaFrame,
  NetworkedTransform,
  NetworkedVideo,
  NetworkedWaypoint,
  Owned
} from "../bit-components";
import { CameraPrefab, CubeMediaFramePrefab } from "../prefabs/camera-tool";
import { MediaPrefab } from "../prefabs/media";
import { defineNetworkSchema } from "../utils/define-network-schema";
import { renderAsEntity } from "../utils/jsx-entity";

const prefabs = new Map(
  Object.entries({
    camera: {
      permission: "spawn_camera",
      template: CameraPrefab
    },
    cube: {
      template: CubeMediaFramePrefab
    },
    media: {
      template: MediaPrefab
    }
  })
);

export function takeOwnership(world: HubsWorld, eid: number) {
  // TODO we do this to have a single API for taking ownership of things in new code, but it obviously relies on NAF/AFrame
  if (hasComponent(world, AEntity, eid)) {
    const el = world.eid2obj.get(eid)!.el!;
    !NAF.utils.isMine(el) && NAF.utils.takeOwnership(el);
  } else {
    addComponent(world, Owned, eid);
    Networked.lastOwnerTime[eid] = Math.max(NAF.connection.getServerTime(), Networked.lastOwnerTime[eid] + 1);
    Networked.owner[eid] = APP.getSid(NAF.clientId);
  }
}

type EntityID = number;
interface CreateMessageData {
  prefabName: string;
  initialData: InitialData;
}
const createMessageDatas: Map<EntityID, CreateMessageData> = new Map();

type InitialData = any;

export function createNetworkedEntityFromRemote(
  world: HubsWorld,
  prefabName: string,
  initialData: InitialData,
  rootNid: string,
  creator: string,
  owner: string
) {
  const eid = renderAsEntity(world, prefabs.get(prefabName)!.template(initialData));
  const obj = world.eid2obj.get(eid)!;

  createMessageDatas.set(eid, { prefabName, initialData });

  let i = 0;
  obj.traverse(function (o) {
    if (o.eid && hasComponent(world, Networked, o.eid)) {
      const eid = o.eid;
      Networked.id[eid] = APP.getSid(i === 0 ? rootNid : `${rootNid}.${i}`);
      APP.world.nid2eid.set(Networked.id[eid], eid);
      Networked.creator[eid] = APP.getSid(creator);
      Networked.owner[eid] = APP.getSid(owner);
      if (NAF.clientId === owner) takeOwnership(world, eid);
      i += 1;
    }
  });

  AFRAME.scenes[0].object3D.add(obj);
  return eid;
}

function spawnAllowed(creator: string, prefabName: string) {
  const perm = prefabs.get(prefabName)!.permission;
  return !perm || APP.hubChannel!.userCan(creator, perm);
}

export function createNetworkedEntity(world: HubsWorld, prefabName: string, initialData: InitialData) {
  if (!spawnAllowed(NAF.clientId, prefabName)) throw new Error(`You do not have permission to spawn ${prefabName}`);
  const rootNid = NAF.utils.createNetworkId();
  return createNetworkedEntityFromRemote(world, prefabName, initialData, rootNid, NAF.clientId, NAF.clientId);
}

const networkedObjectsQuery = defineQuery([Networked]);
const ownedNetworkObjectsQuery = defineQuery([Networked, Owned]);

interface NetworkSchema {
  serialize: (world: HubsWorld, eid: EntityID, data: any, isFullSync: boolean) => boolean;
  deserialize: (world: HubsWorld, eid: EntityID, data: any) => void;
}

const schemas: Map<Component, NetworkSchema> = new Map();
schemas.set(NetworkedMediaFrame, defineNetworkSchema(NetworkedMediaFrame));
schemas.set(NetworkedTransform, defineNetworkSchema(NetworkedTransform));
schemas.set(NetworkedVideo, defineNetworkSchema(NetworkedVideo));
schemas.set(NetworkedWaypoint, defineNetworkSchema(NetworkedWaypoint));
const networkableComponents = Array.from(schemas.keys());

type NetworkID = string;
type CreateMessage = [networkId: NetworkID, prefabName: string, initialData: InitialData];
type UpdateMessage = {
  nid: NetworkID;
  lastOwnerTime: number;
  owner: string;
  creator: string;
  componentIds: number[];
  data: any[];
};
type DeleteMessage = NetworkID;
type Message = {
  creates: CreateMessage[];
  updates: UpdateMessage[];
  deletes: DeleteMessage[];
};
type Join = any;
type Part = any;

type IncomingMessage = any;
const pendingMessages: IncomingMessage[] = [];
const pendingJoins: Join[] = [];
const pendingParts: Part[] = [];

// TODO messaging, joining, and leaving should not be using NAF
if (!NAF) {
  console.warn(
    "NAF is currently required for the new networking system but is not loaded. This is only expected on secondary pages like avatar.html."
  );
} else {
  NAF.connection.subscribeToDataChannel("nn", function (fromClientId, _dataType, data) {
    data.fromClientId = fromClientId;
    console.log("GOT MESSGAE", data);
    pendingMessages.push(data);
  });
}
document.addEventListener("DOMContentLoaded", function () {
  (document.body as any).addEventListener(
    "clientConnected",
    function ({ detail: { clientId } }: { detail: { clientId: string } }) {
      console.log("client joined", clientId);
      pendingJoins.push(APP.getSid(clientId));
    }
  );
  (document.body as any).addEventListener(
    "clientDisconnected",
    function ({ detail: { clientId } }: { detail: { clientId: string } }) {
      console.log("client left", clientId);
      pendingParts.push(APP.getSid(clientId));
    }
  );
});

function messageFor(world: HubsWorld, created: number[], updated: number[], deleted: number[], isFullSync: boolean) {
  const message: Message = {
    creates: [],
    updates: [],
    deletes: []
  };

  created.forEach(eid => {
    const { prefabName, initialData } = createMessageDatas.get(eid)!;
    message.creates.push([APP.getString(Networked.id[eid])!, prefabName, initialData]);
  });

  updated.forEach(eid => {
    const updateMessage: UpdateMessage = {
      nid: APP.getString(Networked.id[eid])!,
      lastOwnerTime: Networked.lastOwnerTime[eid],
      owner: APP.getString(Networked.owner[eid])!, // This should always be NAF.clientId. If it's not, something bad happened
      creator: APP.getString(Networked.creator[eid])!,
      componentIds: [],
      data: []
    };

    for (let j = 0; j < networkableComponents.length; j++) {
      const component = networkableComponents[j];
      if (hasComponent(world, component, eid)) {
        if (schemas.get(component)!.serialize(world, eid, updateMessage.data, isFullSync)) {
          updateMessage.componentIds.push(j);
        }
      }
    }

    // TODO: If the owner/lastOwnerTime changed, we need to send this updateMessage
    if (updateMessage.componentIds.length) {
      message.updates.push(updateMessage);
    }
  });

  deleted.forEach(eid => {
    // TODO: We are reading component data of a deleted entity here.
    const nid = Networked.id[eid];
    message.deletes.push(APP.getString(nid)!);
  });

  if (message.creates.length || message.updates.length || message.deletes.length) {
    return message;
  }

  return null;
}

function isNetworkInstantiated(eid: EntityID) {
  return createMessageDatas.has(eid);
}

function isNetworkInstantiatedByMe(eid: EntityID) {
  return isNetworkInstantiated(eid) && Networked.creator[eid] === APP.getSid(NAF.clientId);
}

const pendingUpdatesForNid = new Map();

const rcvEnteredNetworkedObjectsQuery = enterQuery(defineQuery([Networked]));
export function networkReceiveSystem(world: HubsWorld) {
  // When a user leaves:
  // - locally delete all the entities that user network instantiated
  // - everyone attempts to take ownership of any objects that user owned
  {
    const networkedObjects = networkedObjectsQuery(world);
    pendingParts.forEach(partingClientId => {
      networkedObjects
        .filter(eid => isNetworkInstantiated(eid) && Networked.creator[eid] === partingClientId)
        .forEach(eid => removeEntity(world, eid));

      // ignore entities the parting user created as they were just deleted
      networkedObjects
        .filter(eid => Networked.owner[eid] === partingClientId && Networked.creator[eid] !== partingClientId)
        .forEach(eid => takeOwnership(world, eid)); // TODO: takeOwnershipWithTime(lastReceivedTimestamp)
    });
    pendingParts.length = 0;
  }

  // If we were hanging onto updates for any newly created non network instantiated entities
  // we can now apply them. Network instantiated entities are handled when processing creates.
  rcvEnteredNetworkedObjectsQuery(world).forEach(eid => {
    const nid = Networked.id[eid];
    if (pendingUpdatesForNid.has(nid)) {
      console.log("had pending updates for", APP.getString(nid), pendingUpdatesForNid.get(nid));
      pendingMessages.unshift({ creates: [], updates: pendingUpdatesForNid.get(nid), deletes: [] });
      pendingUpdatesForNid.delete(nid);
    }
  });

  for (let i = 0; i < pendingMessages.length; i++) {
    const message = pendingMessages[i];

    for (let j = 0; j < message.creates.length; j++) {
      const [nidString, prefabName, initialData] = message.creates[j];
      const creator = message.fromClientId;

      const nid = APP.getSid(nidString);

      if (world.deletedNids.has(nid)) {
        // TODO we may need to allow this for reconnects
        console.log(`Received a create message for an object I've already deleted. Skipping ${nidString}`);
      } else if (world.nid2eid.has(nid)) {
        console.log(`Received create message for object I already created. Skipping ${nidString}`);
      } else if (!spawnAllowed(creator, prefabName)) {
        // this should only ever happen if there is a bug or the sender is maliciously modified
        console.log(`Received create from a user who does not have permission to spawn ${prefabName}`);
        world.ignoredNids.add(nid); // TODO should we just use deletedNids for this?
      } else {
        const eid = createNetworkedEntityFromRemote(world, prefabName, initialData, nidString, creator, creator);
        console.log("got create message for", nidString, eid);

        // If we were hanging onto updates for this nid we can now apply them. And they should be processed before other updates.
        if (pendingUpdatesForNid.has(nid)) {
          console.log("had pending updates for", nidString, pendingUpdatesForNid.get(nid));
          Array.prototype.unshift.apply(message.updates, pendingUpdatesForNid.get(nid));
          pendingUpdatesForNid.delete(nid);
        }
      }
    }

    for (let j = 0; j < message.updates.length; j++) {
      const updateMessage = message.updates[j];
      const nid = APP.getSid(updateMessage.nid);

      console.log(updateMessage);

      if (world.ignoredNids.has(nid)) {
        console.log(`Ignoring update for ignored entity ${updateMessage.nid}`);
        continue;
      }

      if (world.deletedNids.has(nid)) {
        console.log(`Ignoring update for deleted entity ${updateMessage.nid}`);
        continue;
      }

      if (!world.nid2eid.has(nid)) {
        console.log(`Holding onto an update for ${updateMessage.nid} because we don't have it yet.`);
        // TODO: What if we will NEVER be able to apply this update?
        // TODO would be nice if we could squash these updates
        const updates = pendingUpdatesForNid.get(nid) || [];
        updates.push(updateMessage);
        pendingUpdatesForNid.set(nid, updates);
        console.log(pendingUpdatesForNid);
        continue;
      }

      const eid = world.nid2eid.get(nid)!;

      if (
        Networked.lastOwnerTime[eid] > updateMessage.lastOwnerTime ||
        (Networked.lastOwnerTime[eid] === updateMessage.lastOwnerTime &&
          APP.getString(Networked.owner[eid])! < updateMessage.owner) // arbitrary (but consistent) tiebreak
      ) {
        console.log(
          "Received update from an old owner, skipping",
          updateMessage.nid,
          Networked.lastOwnerTime[eid],
          updateMessage.lastOwnerTime
        );
        continue;
      }

      if (hasComponent(world, Owned, eid)) {
        if (updateMessage.owner === NAF.clientId) {
          // TODO: Should it be valid that we can receive a message where we are told we are the owner now?
          console.error("Got a message telling us we are the owner.");
        } else {
          console.log("Lost ownership: ", updateMessage.nid);
          removeComponent(world, Owned, eid);
        }
      }

      Networked.lastOwnerTime[eid] = updateMessage.lastOwnerTime;
      Networked.creator[eid] = APP.getSid(updateMessage.creator);
      Networked.owner[eid] = APP.getSid(updateMessage.owner);

      // TODO HACK simulating a buffer with a cursor using an array
      updateMessage.data.cursor = 0;
      for (let s = 0; s < updateMessage.componentIds.length; s++) {
        const componentId = updateMessage.componentIds[s];
        const schema = schemas.get(networkableComponents[componentId])!;
        schema.deserialize(world, eid, updateMessage.data);
      }
      delete updateMessage.data.cursor;
    }

    for (let j = 0; j < message.deletes.length; j += 1) {
      const nid = APP.getSid(message.deletes[j]);
      if (world.deletedNids.has(nid)) continue;

      world.deletedNids.add(nid);
      const eid = world.nid2eid.get(nid)!;
      createMessageDatas.delete(eid);
      world.nid2eid.delete(nid);
      removeEntity(world, eid);

      console.log("OK, deleting ", APP.getString(nid));
    }
  }

  pendingMessages.length = 0;

  // TODO If there's a scene owned object, we should take ownership of it
}

const TICK_RATE = 1000 / 12;
let nextNetworkTick = 0;

const sendEnteredNetworkedObjectsQuery = enterQuery(networkedObjectsQuery);
const sendExitedNetworkedObjectsQuery = exitQuery(networkedObjectsQuery);

export function networkSendSystem(world: HubsWorld) {
  if (performance.now() < nextNetworkTick) return;
  nextNetworkTick = performance.now() + TICK_RATE;

  // Tell joining users about objects I network instantiated, and full updates for objects I own
  {
    if (pendingJoins.length) {
      const message = messageFor(
        world,
        networkedObjectsQuery(world).filter(isNetworkInstantiatedByMe),
        ownedNetworkObjectsQuery(world),
        [],
        true
      );
      if (message) {
        console.log("sending", message);
        pendingJoins.forEach(clientId => NAF.connection.sendDataGuaranteed(APP.getString(clientId)!, "nn", message));
      }
      pendingJoins.length = 0;
    }
  }

  // Tell everyone about objects I created, objects I own, and objects that were deleted
  {
    const created = sendEnteredNetworkedObjectsQuery(world).filter(isNetworkInstantiatedByMe);
    // TODO: Lots of people will send delete messages about the same object
    const deleted = sendExitedNetworkedObjectsQuery(world).filter(eid => {
      return !world.deletedNids.has(Networked.id[eid]) && isNetworkInstantiated(eid);
    });

    const message = messageFor(world, created, ownedNetworkObjectsQuery(world), deleted, false);
    if (message) NAF.connection.broadcastDataGuaranteed("nn", message);

    deleted.forEach(eid => {
      createMessageDatas.delete(eid);
      world.deletedNids.add(Networked.id[eid]);
      world.nid2eid.delete(Networked.id[eid]);
    });
  }
}

// TODO: Handle reconnect
// TODO: Handle blocking/unblocking. Does this already work?
