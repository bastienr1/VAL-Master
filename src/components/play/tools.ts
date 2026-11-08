import type { ComponentType } from 'react'
import { Bomb, CircleQuestionMark, Eraser, MapPin, MousePointer2, MoveUpRight, Pencil, Type } from 'lucide-react'
import type { Tool } from '../PlayCanvas'

/** The canvas tools, shared by the rail and the Theatre dock. */
export const TOOLS: { tool: Tool; name: string; key?: string; Icon: ComponentType<{ className?: string }> }[] = [
  { tool: 'select', name: 'Select', key: 'V', Icon: MousePointer2 },
  { tool: 'pen', name: 'Pen', key: 'P', Icon: Pencil },
  { tool: 'arrow', name: 'Arrow', key: 'A', Icon: MoveUpRight },
  { tool: 'text', name: 'Text', key: 'T', Icon: Type },
  { tool: 'eraser', name: 'Eraser', key: 'E', Icon: Eraser },
  { tool: 'spike', name: 'Spike', Icon: Bomb },
  { tool: 'enemy', name: 'Enemy', Icon: CircleQuestionMark },
  { tool: 'pin', name: 'Pin', Icon: MapPin },
]
