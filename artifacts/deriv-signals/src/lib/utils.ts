import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatPrice(price: number, digits: number = 2) {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(price);
}

export function getSignalColorInfo(signalType: string) {
  switch (signalType) {
    case 'OVER':
      return { color: 'text-emerald-700', bg: 'bg-emerald-50',  border: 'border-emerald-200', glow: 'shadow-lg shadow-emerald-300/50', gradient: 'from-emerald-50 to-transparent', hex: '#059669', gradClass: 'text-gradient-over'  };
    case 'UNDER':
      return { color: 'text-orange-600',  bg: 'bg-orange-50',   border: 'border-orange-200',  glow: 'shadow-lg shadow-orange-300/50',  gradient: 'from-orange-50 to-transparent',  hex: '#ea580c', gradClass: 'text-gradient-under' };
    case 'RISE':
      return { color: 'text-sky-600',     bg: 'bg-sky-50',      border: 'border-sky-200',     glow: 'shadow-lg shadow-sky-300/50',     gradient: 'from-sky-50 to-transparent',     hex: '#0ea5e9', gradClass: 'text-gradient-rise'  };
    case 'FALL':
      return { color: 'text-pink-600',    bg: 'bg-pink-50',     border: 'border-pink-200',    glow: 'shadow-lg shadow-pink-300/50',    gradient: 'from-pink-50 to-transparent',    hex: '#FF4FA3', gradClass: 'text-gradient-fall'  };
    case 'EVEN':
      return { color: 'text-violet-700',  bg: 'bg-violet-50',   border: 'border-violet-200',  glow: 'shadow-lg shadow-violet-300/50',  gradient: 'from-violet-50 to-transparent',  hex: '#7c3aed', gradClass: 'text-gradient-even'  };
    case 'ODD':
      return { color: 'text-amber-700',   bg: 'bg-amber-50',    border: 'border-amber-200',   glow: 'shadow-lg shadow-amber-300/50',   gradient: 'from-amber-50 to-transparent',   hex: '#b45309', gradClass: 'text-gradient-odd'   };
    case 'MATCHES':
      return { color: 'text-teal-700',    bg: 'bg-teal-50',     border: 'border-teal-200',    glow: 'shadow-lg shadow-teal-300/50',    gradient: 'from-teal-50 to-transparent',    hex: '#0f766e', gradClass: 'text-gradient-over'  };
    case 'DIFFERS':
      return { color: 'text-rose-600',    bg: 'bg-rose-50',     border: 'border-rose-200',    glow: 'shadow-lg shadow-rose-300/50',    gradient: 'from-rose-50 to-transparent',    hex: '#e11d48', gradClass: 'text-gradient-fall'  };
    default:
      return { color: 'text-sky-600',     bg: 'bg-sky-50',      border: 'border-sky-200',     glow: '',                                gradient: 'from-sky-50 to-transparent',     hex: '#0ea5e9', gradClass: 'text-gradient-rise'  };
  }
}
