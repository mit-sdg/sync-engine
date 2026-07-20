import { RoomAlreadyOpen, RoomNotOpen } from "./errors.ts";

type Room = { room: string; name: string };

/** Open and close one operations room for each distinct name. */
export class RoomingConcept {
  private readonly rooms = new Map<string, Room>();

  constructor(private readonly freshID: () => string = () => crypto.randomUUID()) {}

  open({ name }: { name: string }) {
    if ([...this.rooms.values()].some((room) => room.name === name)) {
      throw new RoomAlreadyOpen("A room with this name is already open.");
    }
    const room = this.freshID();
    this.rooms.set(room, { room, name });
    return { room };
  }

  close({ room }: { room: string }) {
    if (!this.rooms.delete(room)) throw new RoomNotOpen("This room is not open.");
    return {};
  }

  _get({ room }: { room: string }): Room[] {
    const found = this.rooms.get(room);
    return found === undefined ? [] : [found];
  }
}
