'use client';
import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  PLAYER_GUIDE,
  PLAYER_NOTICE,
  PLAYER_VERSION,
} from '../../../miniprogram/shared/player-guide.js';

export function PlayerGuide({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
}) {
  const title = useRef<HTMLHeadingElement>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="noah guide-dialog"
        showCloseButton={false}
        initialFocus={title}
      >
        <DialogTitle ref={title} tabIndex={-1}>
          第一次登上方舟
        </DialogTitle>
        <DialogDescription>
          先了解如何一起玩。六个角色 · 三维平衡 · 手动裁决。
        </DialogDescription>
        <ol className="guide-steps">
          {PLAYER_GUIDE.map((step, index) => (
            <li key={step.title}>
              <span>{index + 1}</span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="notice">{PLAYER_NOTICE}</p>
        <small>本地内测 · {PLAYER_VERSION}</small>
        <Button onClick={() => onOpenChange(false)}>我了解了，返回游戏</Button>
      </DialogContent>
    </Dialog>
  );
}
