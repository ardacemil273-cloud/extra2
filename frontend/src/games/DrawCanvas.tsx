import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useAuth } from '../context/AuthContext';
import type { RoomState } from '../types';
import type { RealtimeEvent } from '../socket/socket';

interface Point {
  x: number;
  y: number;
}

interface DrawCanvasProps {
  room: RoomState;
  canDraw: boolean;
  onAction: (action: { type: string; payload?: unknown }) => void;
  subscribe: (listener: (event: RealtimeEvent) => void) => () => void;
  height?: number;
  placeholder?: string;
}

const COLORS = ['#e7e7f5', '#f43f5e', '#f59e0b', '#22d3ee', '#22c55e', '#3b82f6', '#a855f7', '#0f0f1a'];

export default function DrawCanvas({
  room,
  canDraw,
  onAction,
  subscribe,
  height = 420,
  placeholder = 'Waiting for the artist…',
}: DrawCanvasProps) {
  const { user } = useAuth();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const penDownRef = useRef(false);
  const pendingPointsRef = useRef<Point[]>([]);
  const lastFlushRef = useRef(0);
  const colorRef = useRef('#7c3aed');
  const sizeRef = useRef(4);
  const toolRef = useRef<'pen' | 'eraser'>('pen');
  const [color, setColor] = useState('#7c3aed');
  const [size, setSize] = useState(4);
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
  const [hasContent, setHasContent] = useState(false);

  const myId = user?.id;

  function getCtx(): CanvasRenderingContext2D | null {
    return canvasRef.current?.getContext('2d') ?? null;
  }

  function resizeCanvas(): void {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    const ctx = getCtx();
    if (ctx) {
      ctx.scale(dpr, dpr);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
    }
  }

  useEffect(() => {
    resizeCanvas();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => resizeCanvas());
    observer.observe(canvas);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyStroke(stroke: { points: Point[]; color: string; size: number; tool: string }): void {
    const ctx = getCtx();
    const canvas = canvasRef.current;
    if (!ctx || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.size;
    for (let i = 0; i < stroke.points.length; i++) {
      const p = stroke.points[i];
      const x = p.x * rect.width;
      const y = p.y * rect.height;
      if (i === 0) {
        ctx.beginPath();
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    if (stroke.points.length > 0) ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }

  function clearCanvas(): void {
    const canvas = canvasRef.current;
    const ctx = getCtx();
    if (!canvas || !ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    setHasContent(false);
  }

  useEffect(() => {
    const unsubscribe = subscribe((event) => {
      if (event.type === 'stroke' && event.payload.from !== myId) {
        applyStroke(event.payload);
        setHasContent(true);
      } else if (event.type === 'clear') {
        clearCanvas();
      }
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myId, subscribe]);

  function localPoint(clientX: number, clientY: number): Point | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
    };
  }

  function flushStroke(): void {
    if (pendingPointsRef.current.length === 0) return;
    const points = pendingPointsRef.current;
    pendingPointsRef.current = [];
    applyStroke({ points, color: colorRef.current, size: sizeRef.current, tool: toolRef.current });
    setHasContent(true);
    onAction({
      type: 'stroke',
      payload: {
        points,
        color: colorRef.current,
        size: sizeRef.current,
        tool: toolRef.current,
      },
    });
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>): void {
    if (!canDraw) return;
    e.preventDefault();
    const p = localPoint(e.clientX, e.clientY);
    if (!p) return;
    drawingRef.current = true;
    penDownRef.current = true;
    pendingPointsRef.current = [p];
    lastFlushRef.current = 0;
    canvasRef.current?.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>): void {
    if (!drawingRef.current) return;
    const p = localPoint(e.clientX, e.clientY);
    if (!p) return;
    pendingPointsRef.current.push(p);
    const now = performance.now();
    if (now - lastFlushRef.current > 40) {
      lastFlushRef.current = now;
      flushStroke();
    }
  }

  function handlePointerUp(e: React.PointerEvent<HTMLCanvasElement>): void {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    penDownRef.current = false;
    try {
      canvasRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    flushStroke();
  }

  const handleClear = () => {
    clearCanvas();
    onAction({ type: 'clear' });
  };

  const setColorPref = (c: string) => {
    colorRef.current = c;
    setColor(c);
  };
  const setSizePref = (s: number) => {
    sizeRef.current = s;
    setSize(s);
  };
  const setToolPref = (t: 'pen' | 'eraser') => {
    toolRef.current = t;
    setTool(t);
  };

  const style: CSSProperties = {
    width: '100%',
    height,
    background: 'rgba(0,0,0,0.35)',
    borderRadius: 14,
    border: '1px solid var(--glass-border)',
    touchAction: 'none',
  };

  return (
    <div className="col">
      <div style={{ position: 'relative' }}>
        <canvas
          ref={canvasRef}
          style={style}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        />
        {!hasContent && (
          <div
            className="text-dim text-sm"
            style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}
          >
            {placeholder}
          </div>
        )}
      </div>
      {canDraw && (
        <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <div className="row" style={{ gap: 6 }}>
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColorPref(c)}
                aria-label={`color ${c}`}
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: '50%',
                  background: c,
                  border: color === c ? '2px solid #fff' : '2px solid transparent',
                  cursor: 'pointer',
                }}
              />
            ))}
          </div>
          <div className="row" style={{ gap: 4, alignItems: 'center' }}>
            {[2, 6, 12].map((s) => (
              <button
                key={s}
                onClick={() => setSizePref(s)}
                aria-label={`size ${s}`}
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  border: size === s ? '1px solid var(--neon-purple)' : '1px solid var(--glass-border)',
                  background: 'rgba(255,255,255,0.05)',
                  cursor: 'pointer',
                }}
              >
                <span
                  style={{
                    display: 'block',
                    width: s,
                    height: s,
                    margin: 'auto',
                    borderRadius: '50%',
                    background: '#fff',
                  }}
                />
              </button>
            ))}
            <button
              onClick={() => setToolPref(tool === 'eraser' ? 'pen' : 'eraser')}
              className="btn btn-ghost text-sm"
              style={{ padding: '6px 12px' }}
            >
              {tool === 'eraser' ? 'Pen' : 'Eraser'}
            </button>
            <button className="btn btn-danger text-sm" onClick={handleClear} style={{ padding: '6px 12px' }}>
              Clear
            </button>
          </div>
          <span className="text-xs text-dim">Room {room.room.code}</span>
        </div>
      )}
    </div>
  );
}
