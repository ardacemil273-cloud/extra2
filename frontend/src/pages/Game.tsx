import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useRealtime } from '../context/RealtimeContext';
import QuizGame from '../games/QuizGame';
import ReactionGame from '../games/ReactionGame';
import RpsGame from '../games/RpsGame';
import DrawGame from '../games/DrawGame';
import TelephoneGame from '../games/TelephoneGame';
import SabotajGame from '../games/SabotajGame';
import ChameleonGame from '../games/ChameleonGame';
import RevealGame from '../games/RevealGame';
import GameOverScreen from '../games/GameOverScreen';
import ChatPanel from '../components/ChatPanel';
import DiscordAd from '../components/DiscordAd';

export default function Game() {
  const { user } = useAuth();
  const { room, game, leaveRoom, restartGame, returnToLobby } = useRealtime();
  const navigate = useNavigate();

  useEffect(() => {
    if (room && room.room.status === 'lobby' && game === null) {
      navigate('/lobby');
    }
  }, [room, game, navigate]);

  if (!room) {
    return (
      <main className="center" style={{ minHeight: '60vh' }}>
        <div className="col center">
          <div className="spinner" />
          <p className="text-dim">Loading room…</p>
        </div>
      </main>
    );
  }

  if (room.room.status === 'lobby') {
    return null;
  }

  if (room.room.status === 'finished') {
    return (
      <GameOverScreen
        room={room}
        game={game}
        isHost={room.room.ownerId === user?.id}
        onPlayAgain={restartGame}
        onReturnToLobby={returnToLobby}
        onLeave={() => {
          leaveRoom();
          navigate('/dashboard');
        }}
      />
    );
  }

  if (!game) {
    return (
      <main className="center" style={{ minHeight: '60vh' }}>
        <div className="col center">
          <div className="spinner" />
          <p className="text-dim">Starting game…</p>
        </div>
      </main>
    );
  }

  const onLeave = () => {
    leaveRoom();
    navigate('/dashboard');
  };

  let gameView: React.ReactNode = null;
  switch (game.type) {
    case 'quiz':
      gameView = <QuizGame room={room} game={game} onLeave={onLeave} />;
      break;
    case 'reaction':
      gameView = <ReactionGame room={room} game={game} onLeave={onLeave} />;
      break;
    case 'rps':
      gameView = <RpsGame room={room} game={game} onLeave={onLeave} />;
      break;
    case 'draw':
      gameView = <DrawGame room={room} game={game} onLeave={onLeave} />;
      break;
    case 'telephone':
      gameView = <TelephoneGame room={room} game={game} onLeave={onLeave} />;
      break;
    case 'sabotaj':
      gameView = <SabotajGame room={room} game={game} onLeave={onLeave} />;
      break;
    case 'chameleon':
      gameView = <ChameleonGame room={room} game={game} onLeave={onLeave} />;
      break;
    case 'reveal':
      gameView = <RevealGame room={room} game={game} onLeave={onLeave} />;
      break;
  }

  return (
    <div className="container" style={{ paddingBottom: 48 }}>
      <DiscordAd />
      <div className="game-with-chat">
        <div style={{ flex: 1, minWidth: 0 }}>{gameView}</div>
        <div style={{ width: 300, flexShrink: 0 }}>
          <ChatPanel />
        </div>
      </div>
    </div>
  );
}
