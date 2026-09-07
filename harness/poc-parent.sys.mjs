// PoC parent actor - relays child reports to the orchestrator via observer
// notifications (same process).
const Services = globalThis.Services;

export class PocReproParent extends JSWindowActorParent {
  receiveMessage(m) {
    try {
      dump("POC-PARENT: receiveMessage " + m.name + "\n");
    } catch (e) {}
    if (m.name === "poc:report" && m.data) {
      try {
        Services.obs.notifyObservers(
          { wrappedJSObject: m.data }, "poc:report", "");
      } catch (e) {}
    }
    return undefined;
  }
}
