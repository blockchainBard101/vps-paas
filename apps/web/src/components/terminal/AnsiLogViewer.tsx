'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Search,
  X,
  Copy,
  Check,
  Clock,
  WrapText,
  Filter,
} from 'lucide-react';

interface AnsiToken {
  text: string;
  color?: string;
  bgColor?: string;
  bold?: boolean;
  dim?: boolean;
  underline?: boolean;
}

interface ParsedLogLine {
  id: number;
  raw: string;
  timestamp?: string;
  displayTime?: string;
  level: 'error' | 'warn' | 'info' | 'normal';
  tokens: AnsiToken[];
}

const ANSI_COLOR_MAP: Record<string, string> = {
  // Standard 30-37
  '30': '#71717a', // Black / Dark Gray
  '31': '#f87171', // Red
  '32': '#34d399', // Green (Emerald)
  '33': '#fbbf24', // Yellow (Amber)
  '34': '#60a5fa', // Blue
  '35': '#c084fc', // Magenta / Purple
  '36': '#22d3ee', // Cyan
  '37': '#f4f4f5', // White

  // High intensity 90-97
  '90': '#a1a1aa', // Bright Black (Zinc 400)
  '91': '#fca5a5', // Bright Red
  '92': '#6ee7b7', // Bright Green
  '93': '#fde047', // Bright Yellow
  '94': '#93c5fd', // Bright Blue
  '95': '#e9d5ff', // Bright Purple
  '96': '#67e8f9', // Bright Cyan
  '97': '#ffffff', // Bright White
};

// 256-color palette shortcuts for terminal tools
const ANSI_256_COLORS: Record<number, string> = {
  1: '#ef4444', // Red
  2: '#10b981', // Green
  3: '#f59e0b', // Amber / Orange
  4: '#3b82f6', // Blue
  5: '#a855f7', // Purple
  6: '#06b6d4', // Cyan
  7: '#e4e4e7', // White
  8: '#71717a', // Gray
  9: '#f87171', // Light Red
  10: '#34d399', // Light Green
  11: '#fbbf24', // Light Yellow
  12: '#60a5fa', // Light Blue
  13: '#c084fc', // Light Magenta
  14: '#22d3ee', // Light Cyan
  15: '#ffffff', // Bright White
  16: '#000000',
  208: '#f97316', // Orange
  214: '#fb923c', // Light Orange
  220: '#facc15', // Gold
  226: '#fef08a', // Yellow
};

// Matches ANSI SGR color/style sequences with optional escape byte (\x1b)
const ANSI_REGEX = /\x1b?\[((?:\d+;?)+)m/g;

// Cleans up non-color terminal sequences (e.g. erase line \x1b[2K, cursor moves, private modes)
const NON_COLOR_ANSI_REGEX = /\x1b\[[0-9;]*[a-ln-zA-Z]|\x1b\([AB0-2]|\x1b\][^\x07\x1b]*[\x07\x1b]/g;

// Docker ISO-8601 timestamp prefix
const DOCKER_TIMESTAMP_REGEX = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\s*/;

function parseAnsiTokens(text: string): AnsiToken[] {
  // Strip non-color terminal controls first
  const sanitized = text.replace(NON_COLOR_ANSI_REGEX, '');

  const tokens: AnsiToken[] = [];
  let lastIndex = 0;
  let currentColor: string | undefined = undefined;
  let currentBgColor: string | undefined = undefined;
  let isBold = false;
  let isDim = false;
  let isUnderline = false;

  ANSI_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = ANSI_REGEX.exec(sanitized)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({
        text: sanitized.slice(lastIndex, match.index),
        color: currentColor,
        bgColor: currentBgColor,
        bold: isBold,
        dim: isDim,
        underline: isUnderline,
      });
    }

    const subCodes = match[1].split(';');
    for (let i = 0; i < subCodes.length; i++) {
      const c = subCodes[i];
      if (c === '0') {
        currentColor = undefined;
        currentBgColor = undefined;
        isBold = false;
        isDim = false;
        isUnderline = false;
      } else if (c === '1') {
        isBold = true;
      } else if (c === '2') {
        isDim = true;
      } else if (c === '4') {
        isUnderline = true;
      } else if (c === '39') {
        currentColor = undefined;
      } else if (c === '49') {
        currentBgColor = undefined;
      } else if (c === '38' && subCodes[i + 1] === '5' && subCodes[i + 2]) {
        const idx = parseInt(subCodes[i + 2], 10);
        currentColor = ANSI_256_COLORS[idx] || (idx === 3 ? '#fbbf24' : '#38bdf8');
        i += 2; // skip sub-arguments
      } else if (c === '48' && subCodes[i + 1] === '5' && subCodes[i + 2]) {
        const idx = parseInt(subCodes[i + 2], 10);
        currentBgColor = ANSI_256_COLORS[idx];
        i += 2;
      } else if (ANSI_COLOR_MAP[c]) {
        currentColor = ANSI_COLOR_MAP[c];
      }
    }

    lastIndex = ANSI_REGEX.lastIndex;
  }

  if (lastIndex < sanitized.length) {
    tokens.push({
      text: sanitized.slice(lastIndex),
      color: currentColor,
      bgColor: currentBgColor,
      bold: isBold,
      dim: isDim,
      underline: isUnderline,
    });
  }

  return tokens;
}

function detectLogLevel(raw: string): 'error' | 'warn' | 'info' | 'normal' {
  const lower = raw.toLowerCase();
  if (
    lower.includes('error:') ||
    lower.includes('err!') ||
    lower.includes('error [') ||
    lower.includes('failed') ||
    lower.includes('exception') ||
    lower.includes('fatal') ||
    lower.includes('error')
  ) {
    return 'error';
  }
  if (lower.includes('warn') || lower.includes('warning:')) {
    return 'warn';
  }
  if (lower.includes('info') || lower.includes(' log ') || lower.includes('[nest]')) {
    return 'info';
  }
  return 'normal';
}

function formatDisplayTime(isoString?: string): string | undefined {
  if (!isoString) return undefined;
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString.slice(11, 23);
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    const secs = String(d.getSeconds()).padStart(2, '0');
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    return `${hours}:${mins}:${secs}.${ms}`;
  } catch {
    return isoString.slice(11, 23);
  }
}

interface AnsiLogViewerProps {
  logs: string;
  autoScroll?: boolean;
  onToggleAutoScroll?: () => void;
  className?: string;
  emptyMessage?: string;
}

export function AnsiLogViewer({
  logs,
  autoScroll = true,
  onToggleAutoScroll,
  className = '',
  emptyMessage = 'Waiting for log output...',
}: AnsiLogViewerProps) {
  const [filterQuery, setFilterQuery] = useState('');
  const [levelFilter, setLevelFilter] = useState<'all' | 'error' | 'warn' | 'info'>('all');
  const [showTimestamps, setShowTimestamps] = useState(true);
  const [wrapLines, setWrapLines] = useState(true);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Parse lines
  const parsedLines = useMemo<ParsedLogLine[]>(() => {
    if (!logs) return [];
    const rawLines = logs.split('\n');
    return rawLines.map((line, index) => {
      let rawText = line;
      let timestamp: string | undefined = undefined;

      const timeMatch = rawText.match(DOCKER_TIMESTAMP_REGEX);
      if (timeMatch) {
        timestamp = timeMatch[1];
        rawText = rawText.slice(timeMatch[0].length);
      }

      const level = detectLogLevel(rawText);
      const tokens = parseAnsiTokens(rawText);

      return {
        id: index,
        raw: line,
        timestamp,
        displayTime: formatDisplayTime(timestamp),
        level,
        tokens,
      };
    });
  }, [logs]);

  // Filter lines
  const filteredLines = useMemo(() => {
    return parsedLines.filter((line) => {
      if (levelFilter === 'error' && line.level !== 'error') return false;
      if (levelFilter === 'warn' && line.level !== 'warn') return false;
      if (levelFilter === 'info' && line.level !== 'info' && line.level !== 'error' && line.level !== 'warn') return false;

      if (filterQuery.trim()) {
        const q = filterQuery.toLowerCase();
        if (!line.raw.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [parsedLines, filterQuery, levelFilter]);

  // Counts
  const counts = useMemo(() => {
    let err = 0;
    let warn = 0;
    let inf = 0;
    for (const l of parsedLines) {
      if (l.level === 'error') err++;
      else if (l.level === 'warn') warn++;
      else if (l.level === 'info') inf++;
    }
    return { error: err, warn, info: inf, total: parsedLines.length };
  }, [parsedLines]);

  // Auto-scroll on new lines
  useEffect(() => {
    if (autoScroll && endRef.current) {
      endRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [filteredLines.length, autoScroll]);

  const handleCopyLine = (id: number, text: string) => {
    const clean = text.replace(ANSI_REGEX, '');
    navigator.clipboard?.writeText(clean);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  return (
    <div className={`flex flex-col rounded-xl border border-zinc-800 bg-[#09090b] overflow-hidden ${className}`}>
      {/* Top Filter & Toolbar */}
      <div className="h-10 px-3 border-b border-zinc-800/80 bg-zinc-900/60 flex items-center justify-between gap-3 text-xs font-mono">
        {/* Search Input */}
        <div className="flex-1 max-w-sm flex items-center gap-2 px-2 py-1 bg-zinc-950/80 border border-zinc-800 rounded-lg text-zinc-300 focus-within:border-indigo-500/60 transition-colors">
          <Search className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
          <input
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder="Filter logs... (e.g. error, nest, b2s)"
            className="w-full bg-transparent text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none"
          />
          {filterQuery && (
            <button
              onClick={() => setFilterQuery('')}
              className="text-zinc-500 hover:text-zinc-300 p-0.5 cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Level Filters & Toggles */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Level Filter Pills */}
          <div className="flex items-center bg-zinc-950 border border-zinc-800 rounded-lg p-0.5 text-[11px]">
            <button
              type="button"
              onClick={() => setLevelFilter('all')}
              className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${
                levelFilter === 'all'
                  ? 'bg-zinc-800 text-zinc-100 font-semibold'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              All ({counts.total})
            </button>
            <button
              type="button"
              onClick={() => setLevelFilter('error')}
              className={`px-2 py-0.5 rounded transition-colors flex items-center gap-1 cursor-pointer ${
                levelFilter === 'error'
                  ? 'bg-red-950/80 text-red-300 font-semibold border border-red-500/30'
                  : counts.error > 0
                  ? 'text-red-400 hover:text-red-300'
                  : 'text-zinc-500 hover:text-zinc-400'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${counts.error > 0 ? 'bg-red-400' : 'bg-zinc-600'}`} />
              Errors {counts.error > 0 && `(${counts.error})`}
            </button>
            <button
              type="button"
              onClick={() => setLevelFilter('warn')}
              className={`px-2 py-0.5 rounded transition-colors flex items-center gap-1 cursor-pointer ${
                levelFilter === 'warn'
                  ? 'bg-amber-950/80 text-amber-300 font-semibold border border-amber-500/30'
                  : counts.warn > 0
                  ? 'text-amber-400 hover:text-amber-300'
                  : 'text-zinc-500 hover:text-zinc-400'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${counts.warn > 0 ? 'bg-amber-400' : 'bg-zinc-600'}`} />
              Warn {counts.warn > 0 && `(${counts.warn})`}
            </button>
          </div>

          <div className="h-4 w-px bg-zinc-800 mx-1" />

          {/* Toggle Timestamps */}
          <button
            type="button"
            onClick={() => setShowTimestamps((prev) => !prev)}
            className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
              showTimestamps
                ? 'bg-zinc-800/80 text-indigo-400 border-indigo-500/30'
                : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:text-zinc-200'
            }`}
            title={showTimestamps ? 'Timestamps visible' : 'Timestamps hidden'}
          >
            <Clock className="w-3.5 h-3.5" />
          </button>

          {/* Toggle Word Wrap */}
          <button
            type="button"
            onClick={() => setWrapLines((prev) => !prev)}
            className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
              wrapLines
                ? 'bg-zinc-800/80 text-indigo-400 border-indigo-500/30'
                : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:text-zinc-200'
            }`}
            title={wrapLines ? 'Word wrap enabled' : 'Word wrap disabled'}
          >
            <WrapText className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main Terminal Output Area */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto overflow-x-auto p-3 font-mono text-[11px] leading-[1.6] select-text selection:bg-zinc-800 selection:text-emerald-300"
      >
        {filteredLines.length === 0 ? (
          <div className="h-full min-h-[260px] flex flex-col items-center justify-center text-zinc-500 gap-2">
            <Filter className="w-6 h-6 text-zinc-600 stroke-1" />
            <p>{filterQuery ? 'No lines matching current filter' : emptyMessage}</p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {filteredLines.map((line, idx) => (
              <div
                key={line.id}
                className={`group flex items-start gap-2.5 px-2 py-0.5 rounded transition-colors hover:bg-zinc-900/60 ${
                  line.level === 'error'
                    ? 'bg-red-950/20 text-red-200 border-l-2 border-red-500/80'
                    : line.level === 'warn'
                    ? 'bg-amber-950/15 text-amber-200 border-l-2 border-amber-500/80'
                    : 'text-zinc-300'
                }`}
              >
                {/* Line Number */}
                <span className="w-7 text-right text-[10px] text-zinc-600 select-none shrink-0 group-hover:text-zinc-400">
                  {idx + 1}
                </span>

                {/* Optional Timestamp */}
                {showTimestamps && line.displayTime && (
                  <span className="text-[10px] text-zinc-500 shrink-0 select-none font-sans font-medium tracking-tight">
                    {line.displayTime}
                  </span>
                )}

                {/* Parsed Colored Text */}
                <span className={`flex-1 min-w-0 ${wrapLines ? 'break-words whitespace-pre-wrap' : 'whitespace-pre'}`}>
                  {line.tokens.length === 0 ? (
                    <span className="text-zinc-600 select-none"> </span>
                  ) : (
                    line.tokens.map((tok, tIdx) => (
                      <span
                        key={tIdx}
                        style={{
                          color: tok.color,
                          backgroundColor: tok.bgColor,
                        }}
                        className={`
                          ${tok.bold ? 'font-bold' : ''}
                          ${tok.dim ? 'opacity-60' : ''}
                          ${tok.underline ? 'underline' : ''}
                        `}
                      >
                        {tok.text}
                      </span>
                    ))
                  )}
                </span>

                {/* Copy Line Action on Hover */}
                <button
                  type="button"
                  onClick={() => handleCopyLine(line.id, line.raw)}
                  className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-zinc-300 p-0.5 transition-opacity shrink-0 cursor-pointer"
                  title="Copy line"
                >
                  {copiedId === line.id ? (
                    <Check className="w-3 h-3 text-emerald-400" />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                </button>
              </div>
            ))}
            <div ref={endRef} />
          </div>
        )}
      </div>
    </div>
  );
}
