"use client";

import React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ArrowUp, Paperclip, Square, X, StopCircle, Mic, Globe, BrainCog } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { ChatInput, ChatInputTextArea, ChatInputSubmit } from "@/components/ui/chat-input";
import { cn } from "@/lib/utils";

// Embedded CSS for minimal custom styles
const styles = `
  *:focus-visible {
    outline-offset: 0 !important;
    --ring-offset: 0 !important;
  }
  textarea::-webkit-scrollbar {
    width: 6px;
  }
  textarea::-webkit-scrollbar-track {
    background: transparent;
  }
  textarea::-webkit-scrollbar-thumb {
    background-color: #22d3ee; /* cyan-400 */
    border-radius: 3px;
    opacity: 0.5;
  }
  textarea::-webkit-scrollbar-thumb:hover {
    background-color: #06b6d4; /* cyan-500 */
  }
`;

// Inject styles into document (safe for client side)
if (typeof document !== 'undefined') {
  const styleSheet = document.createElement("style");
  styleSheet.innerText = styles;
  document.head.appendChild(styleSheet);
}

// We no longer need the custom Textarea here as we use ChatInputTextArea from chat-input.tsx

// Tooltip Components
const TooltipProvider = TooltipPrimitive.Provider;
const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;
const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Content
    ref={ref}
    sideOffset={sideOffset}
    className={cn(
      "z-[100] overflow-hidden rounded-md border border-cyan-500/30 bg-[#0a0a0a]/90 backdrop-blur-md px-3 py-1.5 text-sm text-cyan-50 shadow-[0_0_15px_rgba(34,211,238,0.2)] animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
      className
    )}
    {...props}
  />
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

// Dialog Components
const Dialog = DialogPrimitive.Root;
const DialogPortal = DialogPrimitive.Portal;
const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/80 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-[50%] top-[50%] z-[60] grid w-full max-w-[90vw] md:max-w-[800px] translate-x-[-50%] translate-y-[-50%] gap-4 border border-cyan-500/20 bg-[#0a0a0a] p-0 shadow-[0_0_50px_rgba(34,211,238,0.15)] duration-300 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 rounded-2xl",
        className
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="absolute right-4 top-4 z-10 rounded-full bg-[#111]/80 p-2 hover:bg-[#222] transition-all">
        <X className="h-5 w-5 text-gray-400 hover:text-white" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight text-white", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

// Button Component
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm" | "lg" | "icon";
}
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => {
    const variantClasses = {
      default: "bg-cyan-500 hover:bg-cyan-400 text-black shadow-[0_0_15px_rgba(34,211,238,0.4)] hover:shadow-[0_0_25px_rgba(34,211,238,0.6)]",
      outline: "border border-cyan-500/30 bg-transparent hover:bg-cyan-500/10 text-cyan-400",
      ghost: "bg-transparent hover:bg-white/5 text-gray-300",
    };
    const sizeClasses = {
      default: "h-10 px-4 py-2",
      sm: "h-8 px-3 text-sm",
      lg: "h-12 px-6",
      icon: "h-8 w-8 rounded-full aspect-[1/1]",
    };
    return (
      <button
        className={cn(
          "inline-flex items-center justify-center font-medium transition-all focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
          variantClasses[variant],
          sizeClasses[size],
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

// VoiceRecorder Component
interface VoiceRecorderProps {
  isRecording: boolean;
  onStartRecording: () => void;
  onStopRecording: (duration: number) => void;
  visualizerBars?: number;
}
const VoiceRecorder: React.FC<VoiceRecorderProps> = ({
  isRecording,
  onStartRecording,
  onStopRecording,
  visualizerBars = 32,
}) => {
  const [time, setTime] = React.useState(0);
  const timerRef = React.useRef<NodeJS.Timeout | null>(null);

  React.useEffect(() => {
    if (isRecording) {
      onStartRecording();
      timerRef.current = setInterval(() => setTime((t) => t + 1), 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRecording, time, onStartRecording, onStopRecording]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center w-full transition-all duration-300 py-3",
        isRecording ? "opacity-100" : "opacity-0 h-0"
      )}
    >
      <div className="flex items-center gap-2 mb-3">
        <div className="h-2 w-2 rounded-full bg-red-500 animate-pulse shadow-[0_0_10px_rgba(239,68,68,0.6)]" />
        <span className="font-mono text-sm text-red-400">{formatTime(time)}</span>
      </div>
      <div className="w-full h-10 flex items-center justify-center gap-0.5 px-4">
        {[...Array(visualizerBars)].map((_, i) => (
          <div
            key={i}
            className="w-0.5 rounded-full bg-cyan-400/80 animate-pulse shadow-[0_0_5px_rgba(34,211,238,0.5)]"
            style={{
              height: `${25 + ((i * 37) % 70)}%`,
              animationDelay: `${i * 0.05}s`,
              animationDuration: `${0.5 + ((i * 13) % 5) / 10}s`,
            }}
          />
        ))}
      </div>
    </div>
  );
};

// ImageViewDialog Component
interface ImageViewDialogProps {
  imageUrl: string | null;
  onClose: () => void;
}
const ImageViewDialog: React.FC<ImageViewDialogProps> = ({ imageUrl, onClose }) => {
  if (!imageUrl) return null;
  return (
    <Dialog open={!!imageUrl} onOpenChange={onClose}>
      <DialogContent className="p-0 border-none bg-transparent shadow-none max-w-[90vw] md:max-w-[800px]">
        <DialogTitle className="sr-only">Image Preview</DialogTitle>
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="relative bg-[#0a0a0a] rounded-2xl overflow-hidden shadow-[0_0_50px_rgba(34,211,238,0.15)] border border-cyan-500/20"
        >
          <img
            src={imageUrl}
            alt="Full preview"
            className="w-full max-h-[80vh] object-contain rounded-2xl"
          />
        </motion.div>
      </DialogContent>
    </Dialog>
  );
};

// PromptInput Context and Components
// Custom Divider Component
const CustomDivider: React.FC = () => (
  <div className="relative h-6 w-[1px] mx-1 bg-border/50" />
);

interface PromptInputActionProps extends React.ComponentProps<typeof Tooltip> {
  tooltip: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
}
const PromptInputAction: React.FC<PromptInputActionProps> = ({
  tooltip,
  children,
  className,
  side = "top",
  ...props
}) => {
  return (
    <Tooltip {...props}>
      <TooltipTrigger asChild>
        {children}
      </TooltipTrigger>
      <TooltipContent side={side} className={className}>
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
};

// Main PromptInputBox Component
interface PromptInputBoxProps {
  onSend?: (message: string, files?: File[]) => void;
  onVoiceModeToggle?: (isVoiceMode: boolean) => void;
  isLoading?: boolean;
  placeholder?: string;
  className?: string;
}
export const PromptInputBox = React.forwardRef((props: PromptInputBoxProps, ref: React.Ref<HTMLDivElement>) => {
  const { onSend = () => {}, isLoading = false, placeholder = "Message Tonkl AI...", className } = props;
  const [input, setInput] = React.useState("");

  const handleSubmit = () => {
    if (input.trim()) {
      onSend(input);
      setInput("");
    }
  };

  const hasContent = input.trim() !== "";

  const containerRef = React.useRef<HTMLDivElement>(null);

  const handleSuggestionClick = (suggestion: string) => {
    setInput(suggestion);
    // Focus the textarea so user can continue typing
    setTimeout(() => {
      const ta = containerRef.current?.querySelector("textarea");
      if (ta) {
        ta.focus();
        ta.setSelectionRange(suggestion.length, suggestion.length);
      }
    }, 0);
  };

  return (
    <div ref={containerRef} className={cn("w-full transition-all duration-500 relative flex flex-col items-center gap-4", className)}>
      <ChatInput
        variant="unstyled"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onSubmit={handleSubmit}
        loading={isLoading}
        onStop={() => {}}
        className={cn(
          "w-full max-w-2xl bg-[#0a0a0a] border border-white/10 rounded-[20px] p-2 flex flex-row items-end gap-2 transition-colors focus-within:border-white/20",
          isLoading && "border-white/30 animate-pulse"
        )}
      >
        <ChatInputTextArea 
          placeholder={placeholder}
          className="text-base text-white/90 placeholder:text-white/30 border-none bg-transparent shadow-none focus-visible:ring-0 px-3 py-2 min-h-[44px] leading-relaxed"
        />

        <div className="flex-shrink-0 mb-1 mr-1">
          <ChatInputSubmit 
            className={cn(
              "h-8 w-8 rounded-full flex items-center justify-center transition-all p-0 border-none",
              hasContent || isLoading
                ? "bg-white text-black hover:bg-white/90" 
                : "bg-white/10 text-white/30"
            )}
          />
        </div>
      </ChatInput>

      {/* Suggestions */}
      {!hasContent && !isLoading && (
        <div className="flex flex-wrap items-center justify-center gap-3 mt-1 opacity-80 animate-in fade-in slide-in-from-bottom-2 duration-500">
          <button 
            onClick={() => handleSuggestionClick("I want to create a token called ")}
            className="px-4 py-1.5 rounded-full border border-white/10 bg-white/5 text-sm text-white/70 hover:bg-white/10 hover:text-white hover:border-white/20 transition-all"
          >
            create a token +
          </button>
          <button 
            onClick={() => handleSuggestionClick("I want to send funds to ")}
            className="px-4 py-1.5 rounded-full border border-white/10 bg-white/5 text-sm text-white/70 hover:bg-white/10 hover:text-white hover:border-white/20 transition-all"
          >
            send/receive funds
          </button>
          <button 
            onClick={() => handleSuggestionClick("I want to stake my TNKL ")}
            className="px-4 py-1.5 rounded-full border border-white/10 bg-white/5 text-sm text-white/70 hover:bg-white/10 hover:text-white hover:border-white/20 transition-all"
          >
            Stake tnkl
          </button>
        </div>
      )}
    </div>
  );
});
PromptInputBox.displayName = "PromptInputBox";
