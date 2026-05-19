import React, { useEffect } from "react";
import { X, ExternalLink, Eye, MessageSquare, Heart } from "lucide-react";
import { motion } from "framer-motion";
import * as Avatar from "@radix-ui/react-avatar";

const BASE_MOCK_NEWS = [
  {
    id: 1,
    author: "Oracle Labs",
    handle: "@oracle_labs",
    avatar: "https://images.unsplash.com/photo-1544365558-35aa4afcf11f?w=200&fit=crop",
    title: "Project Athena: The Next Generation Privacy DEX",
    summary: "Trade completely anonymously with deep liquidity.",
    content: "After months of building in stealth, we are proud to unveil Project Athena. Inspired by the goddess of wisdom and warfare, this decentralized exchange is built entirely on Tonkl's zero-knowledge circuits. No front-running. No MEV. Just pure cryptographic warfare.",
    image: "https://images.unsplash.com/photo-1531289196377-50811e513233?w=1200&fit=crop",
    date: "2 hours ago",
    link: "https://tonkl.network/athena",
    views: "24.5k",
    comments: 892,
    likes: "5.2k",
  },
  {
    id: 2,
    author: "Spartan Protocol",
    handle: "@spartan_sec",
    avatar: "https://images.unsplash.com/photo-1560961803-9c864420cc5b?w=200&fit=crop",
    title: "Tonkl V2: The Phalanx Upgrade is Live",
    summary: "The highly anticipated V2 upgrade introduces sub-second shielded transactions.",
    content: "The Phalanx upgrade has officially hit mainnet. This upgrade overhauls our zero-knowledge proof generation pipeline, dropping shielded transaction times from 3 seconds down to a blistering 400ms. All nodes must update their shields to maintain consensus.",
    image: "https://images.unsplash.com/photo-1544365558-35aa4afcf11f?w=1200&fit=crop",
    date: "Yesterday",
    link: "https://tonkl.network/v2-upgrade",
    views: "12.1k",
    comments: 445,
    likes: "3.1k",
  },
  {
    id: 3,
    author: "Tonkl AI",
    handle: "@tonkl_ai",
    avatar: "https://images.unsplash.com/photo-1555580003-8be2dfa646c2?w=200&fit=crop",
    title: "Olympus Voice Node Analytics",
    summary: "Speak directly to the gods... or your wallet.",
    content: "Tonkl AI now natively supports voice interactions via the new Olympus node structure. By tapping the microphone icon in your chat dashboard, you can trigger Voice Mode and issue voice commands that are translated directly into ZK-proof generation.",
    date: "Mar 15, 2026",
    image: "https://images.unsplash.com/photo-1555580003-8be2dfa646c2?w=1200&fit=crop",
    link: "https://tonkl.network/tonkl-ai",
    views: "8.4k",
    comments: 210,
    likes: "1.8k",
  },
];

const MOCK_NEWS = Array.from({ length: 6 }).map((_, i) => ({
  ...BASE_MOCK_NEWS[i % BASE_MOCK_NEWS.length],
  id: i + 1,
}));

export function NewsDashboard({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="w-full bg-[#111111] text-white flex flex-col relative min-h-screen"
    >
      {/* Sticky Background */}
      <div className="fixed inset-0 z-0 bg-black pointer-events-none">
        <img
          src="/david_statue_bg.png"
          alt="Tonkl Background"
          className="w-full h-full object-cover opacity-80"
        />
        <div className="absolute inset-0 bg-[#0a0a0a]/30 backdrop-blur-[20px]" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-black/90" />
      </div>

      {/* Top Nav (Fixed) */}
      <nav className="fixed top-0 left-20 right-0 z-50 flex items-center justify-between p-6 px-6 md:px-12 bg-[#020202]/50 backdrop-blur-md border-b border-white/5">
        <div className="flex items-center gap-4">
          <Avatar.Root className="w-10 h-10 rounded-full overflow-hidden border-2 border-white/10 shadow-[0_0_15px_rgba(34,211,238,0.2)]">
            <Avatar.Image src="/david_pfp.png" className="w-full h-full object-cover" />
            <Avatar.Fallback className="bg-white/10 flex items-center justify-center text-white/50 font-medium">TP</Avatar.Fallback>
          </Avatar.Root>
          <span className="font-serif text-xl tracking-wide text-white/90 font-light">Ecosystem Updates</span>
        </div>
        <button onClick={onClose} className="p-2 rounded-full hover:bg-white/10 hover:text-white transition-colors">
          <X className="w-6 h-6" />
        </button>
      </nav>

      {/* Scrollable Feed Layer */}
      <div className="relative z-10 w-full pt-40 pb-32 flex flex-col items-center gap-16 px-6">
        {MOCK_NEWS.map((post) => (
          <motion.article
            key={post.id}
            initial={{ opacity: 0, y: 80, scale: 0.95 }}
            whileInView={{ opacity: 1, y: 0, scale: 1 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-4xl bg-[#0a0a0a]/50 backdrop-blur-3xl border border-white/10 rounded-3xl overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.5)] flex flex-col md:flex-row group"
          >
            {/* Image Section */}
            <div className="w-full md:w-2/5 h-64 md:h-auto relative overflow-hidden border-b md:border-b-0 md:border-r border-white/10">
              <img
                src={post.image}
                alt={post.title}
                className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-tr from-black/80 to-transparent pointer-events-none" />
            </div>

            {/* Content Section */}
            <div className="w-full md:w-3/5 p-8 md:p-12 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-3 mb-6">
                  <img src={post.avatar} alt={post.author} className="w-10 h-10 rounded-full object-cover border border-white/20" />
                  <div>
                    <h2 className="font-medium text-white/90">{post.author}</h2>
                    <span className="text-white/40 text-xs tracking-wide">{post.handle} • {post.date}</span>
                  </div>
                </div>

                <h1 className="text-3xl md:text-4xl font-light text-white leading-tight mb-4 transition-colors">
                  {post.title}
                </h1>

                <p className="text-base text-white/50 leading-relaxed font-light mb-8">
                  {post.content}
                </p>
              </div>

              {/* Metrics Row */}
              <div className="flex items-center gap-6 text-white/40 font-medium text-xs md:text-sm pt-6 border-t border-white/10">
                <div className="flex items-center gap-2"><Eye className="w-4 h-4" /> {post.views}</div>
                <div className="flex items-center gap-2"><MessageSquare className="w-4 h-4" /> {post.comments}</div>
                <div className="flex items-center gap-2"><Heart className="w-4 h-4" /> {post.likes}</div>
                {post.link && (
                  <a href={post.link} target="_blank" rel="noreferrer" className="flex items-center gap-2 ml-auto text-white/70 hover:text-white transition-colors">
                    Read <ExternalLink className="w-4 h-4" />
                  </a>
                )}
              </div>
            </div>
          </motion.article>
        ))}
      </div>
    </motion.div>
  );
}
