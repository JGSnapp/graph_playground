import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '../../state/store';
import { BoardCanvas } from './BoardCanvas';
import { BoardHeader } from './BoardHeader';

const GAP = 16;
/** Below this width a single board fills the strip; above it, two fit side by side. */
const TWO_UP_BREAKPOINT = 980;

export const BoardsStrip = () => {
  const boards = useStore((s) => s.boards);
  const activeBoardId = useStore((s) => s.activeBoardId);
  const selectBoard = useStore((s) => s.selectBoard);
  const addBoard = useStore((s) => s.addBoard);

  const stripRef = useRef<HTMLDivElement>(null);
  const [cardWidth, setCardWidth] = useState(640);

  useLayoutEffect(() => {
    const node = stripRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      const perView = width >= TWO_UP_BREAKPOINT ? 2 : 1;
      setCardWidth(Math.max(320, (width - GAP * (perView + 1)) / perView));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Keep the selected board in view when selection changes from the chat side.
  useEffect(() => {
    if (!activeBoardId) return;
    stripRef.current
      ?.querySelector(`[data-board-id="${activeBoardId}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }, [activeBoardId]);

  const scrollBy = (direction: -1 | 1) => {
    stripRef.current?.scrollBy({ left: direction * (cardWidth + GAP), behavior: 'smooth' });
  };

  return (
    <section className="boards-area">
      <div className="boards-strip" ref={stripRef}>
        {boards.map((board) => (
          <article
            key={board.id}
            data-board-id={board.id}
            className={`board-card ${board.id === activeBoardId ? 'active' : ''}`}
            style={{ width: cardWidth }}
            onPointerDownCapture={() => {
              if (board.id !== activeBoardId) selectBoard(board.id);
            }}
          >
            <BoardHeader board={board} active={board.id === activeBoardId} />
            <BoardCanvas board={board} active={board.id === activeBoardId} />
          </article>
        ))}

        <button className="board-add" type="button" onClick={() => void addBoard()} style={{ width: 220 }}>
          <span>＋</span>
          Новая доска
        </button>
      </div>

      {boards.length > 0 && (
        <>
          <button className="strip-nav left" type="button" onClick={() => scrollBy(-1)} title="Левее">
            ‹
          </button>
          <button className="strip-nav right" type="button" onClick={() => scrollBy(1)} title="Правее">
            ›
          </button>
        </>
      )}
    </section>
  );
};
