"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Avatar from "@radix-ui/react-avatar";
import { Wallet, HardHat, Coins, MessageSquareLock, FileText, Settings, HelpCircle, LogOut, Newspaper, Dice1, Dice2, Dice3, Dice4, Dice5, Dice6, Dices, Send, ArrowDownToLine, Droplet, History, ScrollText, Pickaxe, Search } from "lucide-react";
import { TonklAIChatOverlay } from "@/components/ui/tonkl-ai-chat-overlay";

const TonklAIIcon = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    {/* Crest Plume */}
    <path d="M4 8C2 2 12 1 15 2c5 2 8 7 7 15-2-3-5-7-9-8-4-1-7-1-9-1z" />
    
    {/* Assistant icon body */}
    <path d="M7 8c5 0 9 1 12 6l-1 4-4-2-3 0-2 5-2-5 1-3-5 0 2-3 2-2z" />
    
    {/* Inner crest detailing lines */}
    <path d="M9 2v6" />
    <path d="M14 3v5" />
    
    {/* Eye cutout detailing */}
    <path d="M7 16l1-3-4 0" />
  </svg>
);

const Real3DDiceButton = () => {
  // Start with an isometric angle so it looks 3D when resting
  const [target, setTarget] = useState({ x: -25, y: -25 }); 
  const [isRolling, setIsRolling] = useState(false);
  const timeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  const resetToIsometric = () => {
    setTarget(prev => ({
      // Find the shortest path back to the -25 degree isometric angle 
      // without unwinding all the previous spins
      x: Math.round(prev.x / 360) * 360 - 25,
      y: Math.round(prev.y / 360) * 360 - 25
    }));
  };

  const roll = () => {
    if (isRolling) return;
    setIsRolling(true);
    
    // Clear any existing inactivity timer when rolling
    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    const result = Math.floor(Math.random() * 6) + 1;
    
    // Target rotation to land on the chosen face
    let rx = 0; let ry = 0;
    switch(result) {
      case 1: rx = 0; ry = 0; break;       // Front
      case 2: rx = 0; ry = -90; break;     // Right
      case 3: rx = -90; ry = 0; break;     // Top
      case 4: rx = 90; ry = 0; break;      // Bottom
      case 5: rx = 0; ry = 90; break;      // Left
      case 6: rx = 180; ry = 0; break;     // Back
    }

    setTarget(prev => {
      // Modulo math ensures we find the shortest path but always add extra spins
      const currentX = prev.x >= 0 ? prev.x % 360 : 360 + (prev.x % 360);
      const currentY = prev.y >= 0 ? prev.y % 360 : 360 + (prev.y % 360);
      
      return {
        x: prev.x + 1080 + (rx - currentX), // 3 full spins + target
        y: prev.y + 1080 + (ry - currentY)
      };
    });

    // Match the CSS transition duration
    setTimeout(() => {
      setIsRolling(false);
      // Start the 5-second inactivity timer to revert
      timeoutRef.current = setTimeout(() => {
        resetToIsometric();
      }, 5000);
    }, 1500);
  };

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  // Glassmorphic blue aesthetic matching the user's image
  // Removed backdrop-blur as WebKit/Blink render a square bounding box for blurs in 3D space
  const faceStyle = "absolute w-full h-full rounded-[4px] bg-gradient-to-br from-blue-500 to-blue-800 shadow-[inset_0_0_0_1px_rgba(147,197,253,0.4),inset_0_0_10px_rgba(255,255,255,0.3)] flex p-1";
  // Silver/white pips with inset shadowing
  const dotStyle = "w-1 h-1 bg-white rounded-full shadow-[inset_0_-0.5px_2px_rgba(0,0,0,0.6),0_0_3px_rgba(255,255,255,0.8)]";

  return (
    <li className="list-none">
      <button 
        onClick={roll}
        className="w-full relative flex items-center justify-center py-4 rounded-xl hover:bg-white/5 transition-all duration-300 group outline-none focus:outline-none"
        style={{ perspective: '800px' }}
      >
        <div 
          className="w-6 h-6 relative"
          style={{
            transformStyle: 'preserve-3d',
            transform: `translateZ(-12px) rotateX(${target.x}deg) rotateY(${target.y}deg)`,
            transition: 'transform 1.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
          }}
        >
          {/* 1: Front */}
          <div className={`${faceStyle} items-center justify-center`} style={{ transform: 'rotateY(0deg) translateZ(12px)' }}>
            <div className={dotStyle} />
          </div>
          {/* 6: Back */}
          <div className={`${faceStyle} justify-between flex-col`} style={{ transform: 'rotateY(180deg) translateZ(12px)' }}>
            <div className="flex justify-between w-full"><div className={dotStyle}/><div className={dotStyle}/></div>
            <div className="flex justify-between w-full"><div className={dotStyle}/><div className={dotStyle}/></div>
            <div className="flex justify-between w-full"><div className={dotStyle}/><div className={dotStyle}/></div>
          </div>
          {/* 2: Right */}
          <div className={`${faceStyle} justify-between`} style={{ transform: 'rotateY(90deg) translateZ(12px)' }}>
            <div className={`${dotStyle} self-start`} />
            <div className={`${dotStyle} self-end`} />
          </div>
          {/* 5: Left */}
          <div className={`${faceStyle} justify-between flex-col`} style={{ transform: 'rotateY(-90deg) translateZ(12px)' }}>
            <div className="flex justify-between w-full"><div className={dotStyle}/><div className={dotStyle}/></div>
            <div className="flex justify-center w-full"><div className={dotStyle}/></div>
            <div className="flex justify-between w-full"><div className={dotStyle}/><div className={dotStyle}/></div>
          </div>
          {/* 3: Top */}
          <div className={`${faceStyle} justify-between flex-col`} style={{ transform: 'rotateX(90deg) translateZ(12px)' }}>
            <div className={`${dotStyle} self-end`} />
            <div className={`${dotStyle} self-center`} />
            <div className={`${dotStyle} self-start`} />
          </div>
          {/* 4: Bottom */}
          <div className={`${faceStyle} justify-between flex-col`} style={{ transform: 'rotateX(-90deg) translateZ(12px)' }}>
            <div className="flex justify-between w-full"><div className={dotStyle}/><div className={dotStyle}/></div>
            <div className="flex justify-between w-full"><div className={dotStyle}/><div className={dotStyle}/></div>
          </div>
        </div>

        <span className="absolute left-16 p-1.5 px-3 rounded-md whitespace-nowrap text-xs font-medium text-white/90 bg-[#1a1a1a] border border-white/10 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-300 shadow-xl z-50">
          Roll Dice
          <span className="absolute top-1/2 -left-1 -translate-y-1/2 border-y-4 border-y-transparent border-r-4 border-r-[#1a1a1a]"></span>
        </span>
      </button>
    </li>
  );
};

const Sidebar = () => {
  const [isTonklAIOpen, setIsTonklAIOpen] = useState(false);

  useEffect(() => {
    const handleOpenTonklAI = () => setIsTonklAIOpen(true);
    window.addEventListener('open-tonkl-ai', handleOpenTonklAI);
    return () => window.removeEventListener('open-tonkl-ai', handleOpenTonklAI);
  }, []);

  const navigation = [
    {
      href: "javascript:void(0)",
      name: "Wallet",
      icon: <Wallet className="w-5 h-5" />,
      action: () => {
        setIsTonklAIOpen(false);
        window.location.hash = "#wallet";
      }
    },
    {
      href: "javascript:void(0)",
      name: "Tonkl AI",
      icon: <TonklAIIcon className="w-5 h-5" />,
      action: () => {
        setIsTonklAIOpen(false);
        if (window.location.hash !== "" && window.location.hash !== "#home") {
          window.location.hash = "#home";
        }
        setTimeout(() => {
          document.getElementById('tonkl-ai-chat-section')?.scrollIntoView({ behavior: 'smooth' });
        }, 50);
      }
    },
    {
      href: "javascript:void(0)",
      name: "Tokens",
      icon: <Coins className="w-5 h-5" />
    },
    {
      href: "javascript:void(0)",
      name: "News",
      icon: <Newspaper className="w-5 h-5" />,
      action: () => {
        setIsTonklAIOpen(false);
        window.location.hash = "#news";
      }
    },
    {
      href: "javascript:void(0)",
      name: "Messages",
      icon: <MessageSquareLock className="w-5 h-5" />
    },
    {
      href: "javascript:void(0)",
      name: "Docs",
      icon: <FileText className="w-5 h-5" />
    },
  ];

  const navsFooter = [
    {
      href: "javascript:void(0)",
      name: "Help",
      icon: <HelpCircle className="w-5 h-5" />
    },
    {
      href: "javascript:void(0)",
      name: "Settings",
      icon: <Settings className="w-5 h-5" />
    },
  ];

  return (
    <nav className="fixed top-0 left-0 w-20 h-full border-r border-white/5 bg-[#020202] flex flex-col z-50">
        <div className="flex items-center justify-center pt-8 pb-4">
          <button 
            onClick={() => {
              window.location.hash = "#home";
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className="flex items-center justify-center hover:scale-110 transition-transform duration-300 group"
          >
            {/* The user's uploaded logo. */}
            <img 
              src="/logo.png" 
              alt="Tonkl Logo" 
              className="w-16 h-16 object-contain opacity-90 group-hover:opacity-100 transition-opacity scale-[1.2]" 
            />
          </button>
        </div>
      
      <div className="flex-1 flex flex-col justify-between pb-6 pt-2 overflow-y-auto">
        <ul className="px-4 space-y-4">
          {navigation.map((item, idx) => (
            <li key={idx}>
              <button
                onClick={item.action}
                className="w-full relative flex items-center justify-center text-white/50 p-3 rounded-xl hover:bg-white/5 hover:text-cyan-400 transition-all duration-300 group"
              >
                <div className="transition-transform duration-300 group-hover:scale-110">{item.icon}</div>
                <span className="absolute left-16 p-1.5 px-3 rounded-md whitespace-nowrap text-xs font-medium text-black bg-cyan-400 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-300 shadow-[0_0_15px_rgba(34,211,238,0.3)] z-50">
                  {item.name}
                  {/* Tooltip triangle */}
                  <span className="absolute top-1/2 -left-1 -translate-y-1/2 border-y-4 border-y-transparent border-r-4 border-r-cyan-400"></span>
                </span>
              </button>
            </li>
          ))}
        </ul>

        <div>
          <ul className="px-4 pb-6 space-y-4">
            {navsFooter.map((item, idx) => (
              <li key={idx}>
                <a
                  href={item.href}
                  className="relative flex items-center justify-center text-white/50 p-3 rounded-xl hover:bg-white/5 hover:text-white/90 transition-all duration-300 group"
                >
                  <div className="transition-transform duration-300 group-hover:scale-110">{item.icon}</div>
                  <span className="absolute left-16 p-1.5 px-3 rounded-md whitespace-nowrap text-xs font-medium text-white/90 bg-[#1a1a1a] border border-white/10 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-300 shadow-xl z-50">
                    {item.name}
                    {/* Tooltip triangle */}
                    <span className="absolute top-1/2 -left-1 -translate-y-1/2 border-y-4 border-y-transparent border-r-4 border-r-[#1a1a1a]"></span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
          
          <div className="px-4 pt-4 border-t border-white/5 flex justify-center">
            <DropdownMenu.Root>
              <DropdownMenu.Trigger className="outline-none">
                <Avatar.Root>
                  <Avatar.Fallback
                    className="flex w-10 h-10 rounded-xl items-center justify-center text-black text-sm font-bold bg-gradient-to-tr from-cyan-600 to-cyan-300 shadow-[0_0_15px_rgba(34,211,238,0.2)] hover:shadow-[0_0_25px_rgba(34,211,238,0.4)] transition-all cursor-pointer hover:scale-105"
                    delayMs={0}
                  >
                    OS
                  </Avatar.Fallback>
                </Avatar.Root>
              </DropdownMenu.Trigger>

              <DropdownMenu.Portal>
                <DropdownMenu.Content className="absolute bottom-2 left-16 w-56 rounded-xl bg-[#111] shadow-2xl border border-white/10 text-sm text-white/70 p-2 z-50 origin-bottom-left animate-in slide-in-from-left-2 fade-in duration-200">
                  <div className="p-2 mb-2 border-b border-white/5">
                    <span className="block text-white/90 font-medium">Tonkl Studio</span>
                    <span className="block text-white/40 text-xs mt-0.5">studio@tonkl.network</span>
                  </div>
                  
                  <DropdownMenu.Item className="outline-none block w-full p-2 text-left rounded-lg hover:bg-white/5 hover:text-white transition-colors cursor-pointer">
                    Dashboard
                  </DropdownMenu.Item>
                  
                  <div className="relative rounded-lg hover:bg-white/5 transition-colors cursor-pointer group mt-1">
                    <select className="w-full cursor-pointer appearance-none bg-transparent p-2 outline-none text-white/70 group-hover:text-white">
                      <option disabled selected className="bg-[#111] text-white">Theme</option>
                      <option className="bg-[#111] text-white">Dark Mode (Active)</option>
                      <option className="bg-[#111] text-white">Light Mode</option>
                    </select>
                  </div>
                  
                  <DropdownMenu.Item className="outline-none flex items-center gap-2 w-full p-2 mt-1 text-left rounded-lg hover:bg-red-500/10 text-red-400 hover:text-red-300 transition-colors cursor-pointer">
                    <LogOut className="w-4 h-4" />
                    Disconnect
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        </div>
      </div>
      
      {/* Global Tonkl AI Chat Overlay rendering from Sidebar root */}
      <TonklAIChatOverlay isOpen={isTonklAIOpen} onClose={() => setIsTonklAIOpen(false)} />
    </nav>
  );
};

export default Sidebar;
