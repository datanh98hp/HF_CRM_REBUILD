"use client"

import { useId, useState, type ReactNode } from "react"
import { ChevronDown } from "lucide-react"
import { Button } from "./button"
import { cn } from "cn"

type AccordionItemProps = {
  title: string
  headingLevel?: 3 | 4
  children: ReactNode
}

function AccordionItem({ title, headingLevel = 4, children }: AccordionItemProps) {
  const [isOpen, setIsOpen] = useState(false)
  const panelId = useId()
  const Heading = headingLevel === 3 ? "h3" : "h4"

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <Heading>
        <Button
          type="button"
          variant="ghost"
          aria-expanded={isOpen}
          aria-controls={panelId}
          onClick={() => setIsOpen((open) => !open)}
          className="group h-auto w-full cursor-pointer justify-between gap-4 rounded-none px-5 py-4 text-left text-pretty text-sm font-medium text-slate-800 hover:bg-transparent aria-expanded:bg-transparent aria-expanded:text-slate-800"
        >
          {title}
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "size-4 shrink-0 text-slate-500 transition-[rotate,color] duration-200 group-hover:text-slate-900 motion-reduce:transition-none",
              isOpen && "rotate-180",
            )}
          />
        </Button>
      </Heading>
      <div
        id={panelId}
        inert={!isOpen}
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none",
          isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="px-5 pb-4 text-pretty text-sm/6 text-slate-600">{children}</div>
        </div>
      </div>
    </div>
  )
}

export { AccordionItem }
