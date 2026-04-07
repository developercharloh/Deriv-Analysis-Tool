import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const MONEY = ['💵','💰','🤑','💷','💴'];
const FLOATERS = Array.from({ length: 20 }, (_, i) => ({
  id: i, emoji: MONEY[i % MONEY.length],
  x: (i * 5.1 + Math.sin(i * 1.7) * 8) % 100,
  size: 20 + (i % 3) * 8, delay: (i * 0.38) % 4.5, dur: 4.5 + (i % 4) * 1.0,
}));

function FloatingMoney() {
  return (
    <div className='absolute inset-0 overflow-hidden pointer-events-none select-none'>
      {FLOATERS.map(f => (
        <motion.span key={f.id} className='absolute'
          style={{ left: `${f.x}%`, bottom: -60, fontSize: f.size, opacity: 0.80 }}
          animate={{ y: [0, -1300] }}
          transition={{ duration: f.dur, repeat: Infinity, ease: 'linear', delay: f.delay }}>
          {f.emoji}
        </motion.span>
      ))}
    </div>
  );
}

const CANDLES = [
  { h:32,body:20,bull:true  }, { h:48,body:30,bull:false },
  { h:24,body:16,bull:true  }, { h:56,body:36,bull:true  },
  { h:40,body:26,bull:false }, { h:64,body:42,bull:true  },
  { h:50,body:34,bull:true  }, { h:36,body:22,bull:false },
  { h:68,body:44,bull:true  }, { h:52,body:34,bull:false },
  { h:44,body:28,bull:true  }, { h:30,body:18,bull:false },
];

function CandleChart() {
  const [revealed, setRevealed] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setRevealed(p => Math.min(p + 1, CANDLES.length)), 200);
    return () => clearInterval(iv);
  }, []);
  return (
    <div className='flex items-end gap-1.5 h-16 px-1'>
      {CANDLES.map((c, i) => (
        <motion.div key={i} className='flex flex-col items-center flex-1' style={{ transformOrigin: 'bottom' }}
          initial={{ scaleY: 0, opacity: 0 }}
          animate={i < revealed ? { scaleY: 1, opacity: 0.80 } : {}}
          transition={{ duration: 0.25, ease: 'backOut' }}>
          <div className='w-px rounded-full' style={{ height: (c.h-c.body)/2, backgroundColor: c.bull ? '#0ea5e9' : '#FF4FA3' }} />
          <div className='w-full rounded-sm border' style={{ height: c.body, backgroundColor: c.bull ? 'rgba(14,165,233,0.22)' : 'rgba(255,79,163,0.22)', borderColor: c.bull ? '#0ea5e9' : '#FF4FA3' }} />
          <div className='w-px rounded-full' style={{ height: c.h/5, backgroundColor: c.bull ? '#0ea5e9' : '#FF4FA3' }} />
        </motion.div>
      ))}
    </div>
  );
}

const TICKERS = [
  { sym:'EURUSD',val:'1.0842',up:true  }, { sym:'GBPUSD',val:'1.2654',up:false },
  { sym:'USDJPY',val:'149.82',up:true  }, { sym:'XAUUSD',val:'2341.5',up:true  },
  { sym:'VOL100',val:'1234.0',up:false }, { sym:'JUMP50',val:'5671.2',up:true  },
  { sym:'VOL75', val:'892.44',up:true  }, { sym:'JUMP25',val:'3102.9',up:false },
  { sym:'VOL25', val:'451.22',up:true  }, { sym:'JD100', val:'9823.1',up:false },
];
const T3X = [...TICKERS,...TICKERS,...TICKERS];

function TickerTape({ pos }: { pos: 'top'|'bottom' }) {
  return (
    <div className={`absolute ${pos==='top'?'top-0':'bottom-0'} left-0 right-0 h-8 flex items-center overflow-hidden`}
      style={{ background:'rgba(255,255,255,0.28)', backdropFilter:'blur(8px)', borderBottom:pos==='top'?'1px solid rgba(255,255,255,0.38)':undefined, borderTop:pos==='bottom'?'1px solid rgba(255,255,255,0.38)':undefined }}>
      <div className='ticker-track flex items-center whitespace-nowrap'>
        {T3X.map((t,i) => (
          <span key={i} className='flex items-center gap-1.5 px-4 border-r border-white/25'>
            <span className='text-[10px] font-mono font-bold text-slate-600'>{t.sym}</span>
            <span className={`text-[10px] font-mono font-bold ${t.up?'text-sky-600':'text-pink-600'}`}>{t.up?'▲':'▼'} {t.val}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function SplashScreen({ onDone }: { onDone: () => void }) {
  const [visible, setVisible] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout>|null>(null);

  useEffect(() => {
    timer.current = setTimeout(() => { setVisible(false); setTimeout(onDone, 600); }, 6400);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [onDone]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className='fixed inset-0 z-[999] flex flex-col items-center justify-center overflow-hidden cursor-pointer'
          style={{ background:'linear-gradient(135deg,#bfdbfe 0%,#e0f2fe 30%,#f5d0fe 65%,#fce7f3 100%)', backgroundSize:'400% 400%', animation:'gradient-border 10s ease infinite' }}
          initial={{ opacity:1 }} exit={{ opacity:0, scale:1.03 }} transition={{ duration:0.55, ease:'easeInOut' }}
          onClick={() => { setVisible(false); setTimeout(onDone, 400); }}>
          <FloatingMoney />
          <TickerTape pos='top' />
          <motion.div className='relative z-10 flex flex-col items-center gap-4 px-10 py-10 rounded-3xl'
            style={{ background:'rgba(255,255,255,0.62)', backdropFilter:'blur(32px)', border:'1px solid rgba(255,255,255,0.78)', boxShadow:'0 8px 60px rgba(14,165,233,0.14),0 2px 0 rgba(255,255,255,0.88) inset', maxWidth:380, width:'90%' }}
            initial={{ opacity:0, scale:0.88, y:24 }} animate={{ opacity:1, scale:1, y:0 }}
            transition={{ delay:0.15, duration:0.7, ease:[0.34,1.56,0.64,1] }}>
            <motion.div className='animate-logo-glow rounded-2xl overflow-hidden'
              initial={{ scale:0.7, opacity:0 }} animate={{ scale:1, opacity:1 }} transition={{ delay:0.3, duration:0.6, ease:'backOut' }}>
              <img src='/logo.png' alt='Elite Signals' className='w-20 h-20 object-contain' />
            </motion.div>
            <motion.p className='text-[10px] font-bold tracking-[0.32em] uppercase text-slate-400'
              initial={{ opacity:0, y:6 }} animate={{ opacity:1, y:0 }} transition={{ delay:0.55, duration:0.5 }}>
              Welcome to
            </motion.p>
            <motion.h1 className='text-4xl font-display font-black text-center leading-tight'
              style={{ background:'linear-gradient(135deg,#0ea5e9,#a855f7,#FF4FA3)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', backgroundClip:'text' }}
              initial={{ opacity:0, y:14 }} animate={{ opacity:1, y:0 }} transition={{ delay:0.72, duration:0.6 }}>
              ELITE<br />SIGNALS
            </motion.h1>
            <motion.div className='flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold tracking-widest uppercase'
              style={{ background:'linear-gradient(90deg,rgba(14,165,233,0.12),rgba(255,79,163,0.12))', border:'1px solid rgba(14,165,233,0.28)' }}
              initial={{ opacity:0 }} animate={{ opacity:1 }} transition={{ delay:1.0, duration:0.5 }}>
              <span className='w-1.5 h-1.5 rounded-full bg-sky-500 animate-pulse' />
              <span style={{ background:'linear-gradient(90deg,#0ea5e9,#FF4FA3)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>AI Powered</span>
            </motion.div>
            <motion.p className='text-sm text-slate-500 font-medium tracking-wide italic text-center'
              initial={{ opacity:0 }} animate={{ opacity:1 }} transition={{ delay:1.15, duration:0.6 }}>
              Home of Infinite Strategies
            </motion.p>
            <motion.div className='w-full' initial={{ opacity:0, y:10 }} animate={{ opacity:1, y:0 }} transition={{ delay:0.55, duration:0.5 }}>
              <CandleChart />
            </motion.div>
            <div className='w-full h-1.5 rounded-full overflow-hidden' style={{ background:'rgba(14,165,233,0.10)' }}>
              <motion.div className='h-full rounded-full' style={{ background:'linear-gradient(90deg,#4FC3F7,#a855f7,#FF4FA3)' }}
                initial={{ width:'0%' }} animate={{ width:'100%' }} transition={{ delay:0.4, duration:5.6, ease:'linear' }} />
            </div>
            <motion.p className='text-[9px] tracking-[0.35em] uppercase text-slate-400'
              initial={{ opacity:0 }} animate={{ opacity:1 }} transition={{ delay:1.3, duration:0.5 }}>
              Initialising markets…
            </motion.p>
          </motion.div>
          <TickerTape pos='bottom' />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
