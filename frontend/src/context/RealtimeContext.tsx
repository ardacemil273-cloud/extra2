import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  AnyGameState,
  ChatMessagePublic,
  GameAward,
  GamePlayerResult,
  NotificationInfo,
  ReactionPublic,
  RoomState,
} from '../types';
import {
  createPartySocket,
  type JoinRoomOptions,
  type PartySocket,
  type RealtimeEvent,
} from '../socket/socket';
import { useAuth } from './AuthContext';
import { useToast } from './ToastContext';
import { getToken } from '../api/token';
import { fetchNotifications, markNotificationsRead as apiMarkNotificationsRead } from '../api';

const ROOM_ID_KEY = 'partyverse_room_id';
const MAX_CHAT_IN_MEMORY = 80;
const MAX_REACTIONS_IN_MEMORY = 20;

interface RealtimeContextValue {
  connected: boolean;
  reconnecting: boolean;
  room: RoomState | null;
  game: AnyGameState | null;
  chatMessages: ChatMessagePublic[];
  reactions: ReactionPublic[];
  lastResults: GamePlayerResult[] | null;
  lastAwards: GameAward[] | null;
  lastHistoryId: string | null;
  notifications: NotificationInfo[];
  unreadNotifications: number;
  refreshNotifications: () => Promise<void>;
  markNotificationsRead: (ids?: string[]) => Promise<void>;
  joinRoom: (code: string) => void;
  joinRoomWithOptions: (opts: JoinRoomOptions) => void;
  leaveRoom: () => void;
  setReady: (ready: boolean) => void;
  selectGame: (gameType: string | null) => void;
  startGame: () => void;
  restartGame: () => void;
  returnToLobby: () => void;
  spectate: (spectating: boolean) => void;
  quickPlay: () => void;
  updateSettings: (settings: { password?: string; maxPlayers?: number | null }) => void;
  setVibe: (vibe: string) => void;
  sendChat: (text: string) => void;
  sendReaction: (emoji: string) => void;
  sendGameAction: (action: { type: string; payload?: unknown }) => void;
  kickPlayer: (userId: string) => void;
  mutePlayer: (userId: string, muted: boolean) => void;
  inviteFriend: (userId: string) => void;
  subscribeGame: (listener: (event: RealtimeEvent) => void) => () => void;
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const socketRef = useRef<PartySocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [game, setGame] = useState<AnyGameState | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessagePublic[]>([]);
  const [reactions, setReactions] = useState<ReactionPublic[]>([]);
  const [lastResults, setLastResults] = useState<GamePlayerResult[] | null>(null);
  const [lastAwards, setLastAwards] = useState<GameAward[] | null>(null);
  const [lastHistoryId, setLastHistoryId] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<NotificationInfo[]>([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const hadRoomRef = useRef(false);
  const gameListeners = useRef(new Set<(event: RealtimeEvent) => void>());

  const notifyGameListeners = useCallback((event: RealtimeEvent) => {
    for (const listener of gameListeners.current) {
      listener(event);
    }
  }, []);

  useEffect(() => {
    if (!user) {
      socketRef.current?.dispose();
      socketRef.current = null;
      setConnected(false);
      setReconnecting(false);
      setRoom(null);
      setGame(null);
      setChatMessages([]);
      setReactions([]);
      setLastResults(null);
      return;
    }
    const socket = createPartySocket();
    socketRef.current = socket;
    socket.connect(getToken() ?? '');
    const unsubscribe = socket.on((event) => {
      switch (event.type) {
        case 'connect': {
          setConnected(true);
          const roomId = localStorage.getItem(ROOM_ID_KEY);
          if (roomId) {
            setReconnecting(true);
            socket.rejoinRoom(roomId);
          }
          break;
        }
        case 'disconnect': {
          setConnected(false);
          if (hadRoomRef.current) {
            setReconnecting(true);
          }
          break;
        }
        case 'connect_error': {
          setConnected(false);
          if (hadRoomRef.current) {
            setReconnecting(true);
          }
          break;
        }
        case 'room': {
          if (event.payload === null) {
            localStorage.removeItem(ROOM_ID_KEY);
            hadRoomRef.current = false;
      setRoom(null);
      setGame(null);
      setChatMessages([]);
      setReactions([]);
      setLastResults(null);
      setLastAwards(null);
      setLastHistoryId(null);
      setReconnecting(false);
          } else {
            hadRoomRef.current = true;
            localStorage.setItem(ROOM_ID_KEY, event.payload.room.id);
            setReconnecting(false);
            setRoom(event.payload);
          }
          break;
        }
        case 'game': {
          setGame(event.payload);
          break;
        }
        case 'chat': {
          setChatMessages((prev) => {
            const next = [...prev, event.payload];
            return next.length > MAX_CHAT_IN_MEMORY ? next.slice(-MAX_CHAT_IN_MEMORY) : next;
          });
          break;
        }
        case 'reaction': {
          setReactions((prev) => {
            const next = [...prev, event.payload];
            return next.length > MAX_REACTIONS_IN_MEMORY ? next.slice(-MAX_REACTIONS_IN_MEMORY) : next;
          });
          break;
        }
        case 'stroke':
        case 'clear':
        case 'revealGuess':
        case 'finished': {
          if (event.type === 'finished') {
            setLastResults(event.payload.results);
            setLastAwards(event.payload.awards);
            setLastHistoryId(event.payload.historyId ?? null);
          }
          notifyGameListeners(event);
          break;
        }
        case 'kicked': {
          toast(`You were kicked from ${event.payload.roomName}.`, 'error');
          localStorage.removeItem(ROOM_ID_KEY);
          hadRoomRef.current = false;
          setRoom(null);
          setGame(null);
          setChatMessages([]);
          setReactions([]);
          setLastResults(null);
          setLastAwards(null);
          break;
        }
        case 'muted': {
          toast(event.payload.muted ? 'You have been muted by the host.' : 'You are no longer muted.', 'info');
          break;
        }
        case 'notification': {
          setNotifications((prev) => [event.payload, ...prev].slice(0, 40));
          setUnreadNotifications((prev) => prev + (event.payload.read ? 0 : 1));
          break;
        }
        case 'error': {
          const { code, message } = event.payload;
          toast(message, 'error');
          if (code === 'not-in-room' || code === 'room-not-found') {
            localStorage.removeItem(ROOM_ID_KEY);
            hadRoomRef.current = false;
            setRoom(null);
            setGame(null);
            setChatMessages([]);
            setReactions([]);
          }
          break;
        }
      }
    });
    return () => {
      unsubscribe();
      socket.dispose();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const joinRoom = useCallback((code: string) => {
    const socket = socketRef.current;
    if (!socket) return;
    localStorage.setItem(ROOM_ID_KEY, '');
    hadRoomRef.current = false;
    setRoom(null);
    setGame(null);
    setChatMessages([]);
    setReactions([]);
    socket.joinRoom(code);
  }, []);

  const joinRoomWithOptions = useCallback((opts: JoinRoomOptions) => {
    const socket = socketRef.current;
    if (!socket) return;
    localStorage.setItem(ROOM_ID_KEY, '');
    hadRoomRef.current = false;
    setRoom(null);
    setGame(null);
    setChatMessages([]);
    setReactions([]);
    socket.joinRoom(opts.code, opts.password, opts.spectate);
  }, []);

  const leaveRoom = useCallback(() => {
    localStorage.removeItem(ROOM_ID_KEY);
    hadRoomRef.current = false;
    socketRef.current?.leaveRoom();
  }, []);

  const setReady = useCallback((ready: boolean) => {
    socketRef.current?.setReady(ready);
  }, []);

  const selectGame = useCallback((gameType: string | null) => {
    socketRef.current?.selectGame(gameType);
  }, []);

  const startGame = useCallback(() => {
    socketRef.current?.startGame();
  }, []);

  const restartGame = useCallback(() => {
    socketRef.current?.restartGame();
  }, []);

  const returnToLobby = useCallback(() => {
    socketRef.current?.returnToLobby();
  }, []);

  const spectate = useCallback((spectating: boolean) => {
    socketRef.current?.spectate(spectating);
  }, []);

  const quickPlay = useCallback(() => {
    socketRef.current?.quickPlay();
  }, []);

  const updateSettings = useCallback(
    (settings: { password?: string; maxPlayers?: number | null }) => {
      socketRef.current?.updateSettings(settings);
    },
    [],
  );

  const setVibe = useCallback((vibe: string) => {
    socketRef.current?.setVibe(vibe);
  }, []);

  const sendChat = useCallback((text: string) => {
    socketRef.current?.sendChat(text);
  }, []);

  const sendReaction = useCallback((emoji: string) => {
    socketRef.current?.sendReaction(emoji);
  }, []);

  const sendGameAction = useCallback((action: { type: string; payload?: unknown }) => {
    socketRef.current?.sendGameAction(action);
  }, []);

  const kickPlayer = useCallback((userId: string) => {
    socketRef.current?.kickPlayer(userId);
  }, []);

  const mutePlayer = useCallback((userId: string, muted: boolean) => {
    socketRef.current?.mutePlayer(userId, muted);
  }, []);

  const inviteFriend = useCallback((userId: string) => {
    socketRef.current?.inviteFriend(userId);
  }, []);

  const refreshNotifications = useCallback(async () => {
    try {
      const { notifications: list, unread } = await fetchNotifications();
      setNotifications(list);
      setUnreadNotifications(unread);
    } catch {
      // ignore
    }
  }, []);

  const markNotificationsRead = useCallback(async (ids?: string[]) => {
    await apiMarkNotificationsRead(ids);
    if (ids && ids.length > 0) {
      setUnreadNotifications((prev) => Math.max(0, prev - ids.length));
    } else {
      setUnreadNotifications(0);
    }
  }, []);

  const subscribeGame = useCallback((listener: (event: RealtimeEvent) => void) => {
    gameListeners.current.add(listener);
    return () => {
      gameListeners.current.delete(listener);
    };
  }, []);

  const value = useMemo(
    () => ({
      connected,
      reconnecting,
      room,
      game,
      chatMessages,
      reactions,
      lastResults,
      lastAwards,
      lastHistoryId,
      notifications,
      unreadNotifications,
      refreshNotifications,
      markNotificationsRead,
      joinRoom,
      joinRoomWithOptions,
      leaveRoom,
      setReady,
      selectGame,
      startGame,
      restartGame,
      returnToLobby,
      spectate,
      quickPlay,
      updateSettings,
      setVibe,
      sendChat,
      sendReaction,
      sendGameAction,
      kickPlayer,
      mutePlayer,
      inviteFriend,
      subscribeGame,
    }),
    [
      connected,
      reconnecting,
      room,
      game,
      chatMessages,
      reactions,
      lastResults,
      lastAwards,
      lastHistoryId,
      notifications,
      unreadNotifications,
      refreshNotifications,
      markNotificationsRead,
      joinRoom,
      joinRoomWithOptions,
      leaveRoom,
      setReady,
      selectGame,
      startGame,
      restartGame,
      returnToLobby,
      spectate,
      quickPlay,
      updateSettings,
      setVibe,
      sendChat,
      sendReaction,
      sendGameAction,
      kickPlayer,
      mutePlayer,
      inviteFriend,
      subscribeGame,
    ],
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime(): RealtimeContextValue {
  const ctx = useContext(RealtimeContext);
  if (!ctx) {
    throw new Error('useRealtime must be used within RealtimeProvider');
  }
  return ctx;
}
