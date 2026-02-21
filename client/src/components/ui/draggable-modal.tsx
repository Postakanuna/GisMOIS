import { useState, useRef, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { X, GripHorizontal, Minimize2, Maximize2, Minus } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";

interface DraggableModalProps {
  isOpen: boolean;
  onClose: () => void;
  onBeforeClose?: () => boolean | void;
  title: string;
  children: React.ReactNode;
  defaultWidth?: number;
  defaultHeight?: number;
  minWidth?: number;
  minHeight?: number;
}

export function DraggableModal({
  isOpen,
  onClose,
  onBeforeClose,
  title,
  children,
  defaultWidth = 800,
  defaultHeight = 400,
  minWidth = 400,
  minHeight = 200,
}: DraggableModalProps) {
  const isMobile = useIsMobile();
  const [position, setPosition] = useState({ x: 100, y: 100 });
  const [size, setSize] = useState({ width: defaultWidth, height: defaultHeight });
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [resizeDirection, setResizeDirection] = useState<string | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [preMinimizeSize, setPreMinimizeSize] = useState(size);
  const [preMaximizeState, setPreMaximizeState] = useState({ position, size });
  
  const modalRef = useRef<HTMLDivElement>(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  const resizeStart = useRef({ x: 0, y: 0, width: 0, height: 0, posX: 0, posY: 0 });

  useEffect(() => {
    if (isOpen && !isMobile) {
      setIsMinimized(false);
      setIsMaximized(false);
      const x = Math.max(50, (window.innerWidth - defaultWidth) / 2);
      const y = Math.max(50, (window.innerHeight - defaultHeight) / 2);
      setPosition({ x, y });
      setSize({ width: defaultWidth, height: defaultHeight });
    }
  }, [isOpen, defaultWidth, defaultHeight, isMobile]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (isMaximized || isMobile) return;
    e.preventDefault();
    setIsDragging(true);
    dragOffset.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    };
  }, [position, isMaximized, isMobile]);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent, direction: string) => {
    if (isMaximized || isMobile) return;
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    setResizeDirection(direction);
    resizeStart.current = {
      x: e.clientX,
      y: e.clientY,
      width: size.width,
      height: size.height,
      posX: position.x,
      posY: position.y,
    };
  }, [size, position, isMaximized, isMobile]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        const newX = Math.max(0, Math.min(window.innerWidth - 100, e.clientX - dragOffset.current.x));
        const newY = Math.max(0, Math.min(window.innerHeight - 50, e.clientY - dragOffset.current.y));
        setPosition({ x: newX, y: newY });
      }
      
      if (isResizing && resizeDirection) {
        const deltaX = e.clientX - resizeStart.current.x;
        const deltaY = e.clientY - resizeStart.current.y;
        
        let newWidth = resizeStart.current.width;
        let newHeight = resizeStart.current.height;
        let newX = resizeStart.current.posX;
        let newY = resizeStart.current.posY;
        
        if (resizeDirection.includes("e")) {
          newWidth = Math.max(minWidth, resizeStart.current.width + deltaX);
        }
        if (resizeDirection.includes("w")) {
          const potentialWidth = resizeStart.current.width - deltaX;
          if (potentialWidth >= minWidth) {
            newWidth = potentialWidth;
            newX = resizeStart.current.posX + deltaX;
          }
        }
        if (resizeDirection.includes("s")) {
          newHeight = Math.max(minHeight, resizeStart.current.height + deltaY);
        }
        if (resizeDirection.includes("n")) {
          const potentialHeight = resizeStart.current.height - deltaY;
          if (potentialHeight >= minHeight) {
            newHeight = potentialHeight;
            newY = resizeStart.current.posY + deltaY;
          }
        }
        
        setSize({ width: newWidth, height: newHeight });
        setPosition({ x: newX, y: newY });
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setIsResizing(false);
      setResizeDirection(null);
    };

    if (isDragging || isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      return () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [isDragging, isResizing, resizeDirection, minWidth, minHeight]);

  const toggleMinimize = useCallback(() => {
    if (isMobile) return;
    if (isMinimized) {
      setSize(preMinimizeSize);
      setIsMinimized(false);
    } else {
      if (isMaximized) {
        setPosition(preMaximizeState.position);
        setIsMaximized(false);
        setPreMinimizeSize(preMaximizeState.size);
      } else {
        setPreMinimizeSize(size);
      }
      setIsMinimized(true);
    }
  }, [isMinimized, isMaximized, size, preMinimizeSize, preMaximizeState, isMobile]);

  const toggleMaximize = useCallback(() => {
    if (isMobile) return;
    if (isMinimized) {
      setIsMinimized(false);
      setPreMaximizeState({ position, size: preMinimizeSize });
      setPosition({ x: 10, y: 10 });
      setSize({ width: window.innerWidth - 20, height: window.innerHeight - 20 });
      setIsMaximized(true);
      return;
    }
    if (isMaximized) {
      setPosition(preMaximizeState.position);
      setSize(preMaximizeState.size);
      setIsMaximized(false);
    } else {
      setPreMaximizeState({ position, size });
      setPosition({ x: 10, y: 10 });
      setSize({ width: window.innerWidth - 20, height: window.innerHeight - 20 });
      setIsMaximized(true);
    }
  }, [isMaximized, isMinimized, position, size, preMaximizeState, preMinimizeSize, isMobile]);

  const handleClose = useCallback(() => {
    if (onBeforeClose) {
      const shouldPreventClose = onBeforeClose();
      if (shouldPreventClose === true) {
        return;
      }
    }
    onClose();
  }, [onBeforeClose, onClose]);

  if (!isOpen) return null;

  if (isMobile) {
    return (
      <div 
        className="fixed inset-0 z-[60] bg-background flex flex-col"
        data-testid="draggable-modal-mobile"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/50 shrink-0">
          <CardTitle className="text-sm font-medium truncate pr-2">{title}</CardTitle>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 shrink-0"
            onClick={handleClose}
            data-testid="button-close-modal"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1 overflow-auto">
          {children}
        </div>
      </div>
    );
  }

  return (
    <div 
      className="fixed inset-0 z-[60] pointer-events-none"
      data-testid="draggable-modal-overlay"
    >
      <Card
        ref={modalRef}
        className="absolute pointer-events-auto bg-background shadow-xl border flex flex-col"
        style={{
          left: position.x,
          top: position.y,
          width: isMinimized ? Math.min(size.width, 320) : size.width,
          height: isMinimized ? 'auto' : size.height,
        }}
        data-testid="draggable-modal"
      >
        <CardHeader 
          className="py-2 px-3 flex flex-row items-center justify-between gap-2 cursor-move border-b shrink-0"
          onMouseDown={handleMouseDown}
        >
          <div className="flex items-center gap-2 min-w-0">
            <GripHorizontal className="h-4 w-4 text-muted-foreground shrink-0" />
            <CardTitle className="text-sm font-medium truncate">{title}</CardTitle>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              onClick={toggleMinimize}
              data-testid="button-toggle-minimize"
              title={isMinimized ? "Развернуть" : "Свернуть"}
            >
              {isMinimized ? <Maximize2 className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
            </Button>
            {!isMinimized && (
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                onClick={toggleMaximize}
                data-testid="button-toggle-maximize"
              >
                {isMaximized ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
              </Button>
            )}
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              onClick={handleClose}
              data-testid="button-close-modal"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        </CardHeader>
        
        {!isMinimized && (
          <CardContent className="p-0 flex-1 overflow-hidden">
            {children}
          </CardContent>
        )}

        {!isMaximized && !isMinimized && (
          <>
            <div
              className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
              onMouseDown={(e) => handleResizeMouseDown(e, "se")}
            />
            <div
              className="absolute bottom-0 left-0 w-4 h-4 cursor-sw-resize"
              onMouseDown={(e) => handleResizeMouseDown(e, "sw")}
            />
            <div
              className="absolute top-0 right-0 w-4 h-4 cursor-ne-resize"
              onMouseDown={(e) => handleResizeMouseDown(e, "ne")}
            />
            <div
              className="absolute top-0 left-0 w-4 h-4 cursor-nw-resize"
              onMouseDown={(e) => handleResizeMouseDown(e, "nw")}
            />
            <div
              className="absolute top-4 bottom-4 right-0 w-1 cursor-e-resize"
              onMouseDown={(e) => handleResizeMouseDown(e, "e")}
            />
            <div
              className="absolute top-4 bottom-4 left-0 w-1 cursor-w-resize"
              onMouseDown={(e) => handleResizeMouseDown(e, "w")}
            />
            <div
              className="absolute left-4 right-4 bottom-0 h-1 cursor-s-resize"
              onMouseDown={(e) => handleResizeMouseDown(e, "s")}
            />
            <div
              className="absolute left-4 right-4 top-0 h-1 cursor-n-resize"
              onMouseDown={(e) => handleResizeMouseDown(e, "n")}
            />
          </>
        )}
      </Card>
    </div>
  );
}
