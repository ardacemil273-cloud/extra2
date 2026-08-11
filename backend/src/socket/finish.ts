import type { LiveRoom } from './store';
import { persistScores, setRoomStatus } from './persist';
import { finalizeGame } from '../games/core';

export function attachFinishHook(room: LiveRoom): void {
  room.onFinished = () => {
    void persistScores(room).catch((err) => {
      console.error('[partyverse] failed to persist scores', err);
    });
    void setRoomStatus(room.id, 'finished').catch((err) => {
      console.error('[partyverse] failed to persist room status', err);
    });
    finalizeGame(room);
  };
}
