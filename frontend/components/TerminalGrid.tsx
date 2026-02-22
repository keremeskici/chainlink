'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

// ─── Types ──────────────────────────────────────────────────────────
export interface ModelParams {
    name: string;
}

// ─── Provider mapping ───────────────────────────────────────────────
const MODEL_PROVIDERS: Record<string, string> = {
    'o3-mini': 'OpenAI',
    'gpt-4o': 'OpenAI',
    'gpt-4': 'OpenAI',
    'claude-sonnet-4-6': 'Anthropic',
    'claude-3-5-sonnet-20241022': 'Anthropic',
    'gemini-2.5-flash': 'Google',
    'gemini-1.5-pro': 'Google',
    'deepseek-reasoner': 'DeepSeek',
    'deepseek-chat': 'DeepSeek',
};

function getProviderName(modelName: string) {
    return MODEL_PROVIDERS[modelName] || 'Unknown';
}

export interface Market {
    id: string;
    question: string;
    description: string;
    options: string[];
    volume: string;
}

interface TerminalGridProps {
    models: ModelParams[];
    market: Market;
    onComplete: (winner: string | null) => void;
}

interface TerminalLine {
    text: string;
    color: 'white' | 'gray' | 'green' | 'red' | 'yellow' | 'cyan';
    animate?: boolean;
}

interface ModelState {
    lines: TerminalLine[];
    verdict: string | null;
    status: 'idle' | 'prompting' | 'done' | 'error';
}

interface ConsensusData {
    resolved: boolean;
    winner: string | null;
    voteCounts: Record<string, number>;
    totalVotes: number;
    txHash?: string;
}

// ─── Component ──────────────────────────────────────────────────────
export function TerminalGrid({ models, market, onComplete }: TerminalGridProps) {
    const [globalLines, setGlobalLines] = useState<TerminalLine[]>([]);
    const [modelStates, setModelStates] = useState<Record<string, ModelState>>({});
    const [phase, setPhase] = useState<string>('idle');
    const [consensus, setConsensus] = useState<ConsensusData | null>(null);
    const [showOverlay, setShowOverlay] = useState(false);
    const [chainStatus, setChainStatus] = useState<string | null>(null);
    const abortRef = useRef<AbortController | null>(null);
    const terminalRefs = useRef<Record<string, HTMLDivElement | null>>({});
    // Ref bridge: the async SSE reader always calls the latest handler
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleSSEEventRef = useRef<(data: any) => void>(() => { });

    // Auto-scroll terminals
    const scrollTerminal = useCallback((name: string) => {
        const el = terminalRefs.current[name];
        if (el) el.scrollTop = el.scrollHeight;
    }, []);

    // Initialize model states
    useEffect(() => {
        const initial: Record<string, ModelState> = {};
        models.forEach((m) => {
            initial[m.name] = { lines: [], verdict: null, status: 'idle' };
        });
        setModelStates(initial);
    }, [models]);

    // Add a line to a specific model's terminal
    const addModelLine = useCallback(
        (model: string, line: TerminalLine) => {
            setModelStates((prev) => {
                const state = prev[model];
                if (!state) return prev;
                return {
                    ...prev,
                    [model]: { ...state, lines: [...state.lines, line] },
                };
            });
            setTimeout(() => scrollTerminal(model), 50);
        },
        [scrollTerminal]
    );

    // Add a line to ALL model terminals
    const addGlobalLine = useCallback(
        (line: TerminalLine) => {
            setGlobalLines((prev) => [...prev, line]);
            models.forEach((m) => {
                addModelLine(m.name, line);
            });
        },
        [models, addModelLine]
    );

    // Update a model's status
    const setModelStatus = useCallback(
        (model: string, status: ModelState['status'], verdict?: string) => {
            setModelStates((prev) => {
                const state = prev[model];
                if (!state) return prev;
                return {
                    ...prev,
                    [model]: { ...state, status, verdict: verdict ?? state.verdict },
                };
            });
        },
        []
    );

    // ─── SSE event handler (defined BEFORE useEffect so it's in scope) ──
    const handleSSEEvent = useCallback(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (data: any) => {
            switch (data.event) {
                case 'phase':
                    setPhase(data.phase);
                    if (data.phase === 'news_fetch_start') {
                        addGlobalLine({
                            text: '> INITIATING NEWS CONTEXT FETCH (CHAINLINK HTTP)...',
                            color: 'yellow',
                        });
                    } else if (data.phase === 'news_fetch_complete') {
                        addGlobalLine({
                            text: '> NEWS CONTEXT LOADED',
                            color: 'green',
                        });
                        addGlobalLine({ text: '', color: 'gray' });
                        addGlobalLine({
                            text: '─────────────────────────────────',
                            color: 'gray',
                        });
                    } else if (data.phase === 'swarm_start') {
                        addGlobalLine({
                            text: '> INITIATING AI SWARM (CHAINLINK CONFIDENTIAL HTTP)...',
                            color: 'yellow',
                        });
                        addGlobalLine({ text: '', color: 'gray' });
                    } else if (data.phase === 'consensus_start') {
                        addGlobalLine({ text: '', color: 'gray' });
                        addGlobalLine({
                            text: '─────────────────────────────────',
                            color: 'gray',
                        });
                        addGlobalLine({
                            text: '> CALCULATING CONSENSUS...',
                            color: 'yellow',
                            animate: true,
                        });
                    } else if (data.phase === 'chain_write') {
                        addGlobalLine({
                            text: '> WRITING VERDICT ON-CHAIN...',
                            color: 'yellow',
                            animate: true,
                        });
                    }
                    break;

                case 'news_fetch':
                    if (data.status === 'fetching') {
                        addGlobalLine({
                            text: `>   Fetching ${data.source}...`,
                            color: 'white',
                            animate: true,
                        });
                    } else if (data.status === 'done') {
                        addGlobalLine({
                            text: `>   ✓ ${data.source}: ${data.chars} chars loaded`,
                            color: 'green',
                        });
                    } else if (data.status === 'error') {
                        addGlobalLine({
                            text: `>   ✗ ${data.source}: ${data.error}`,
                            color: 'red',
                        });
                    }
                    break;

                case 'model_start':
                    addModelLine(data.model, {
                        text: `> PROMPTING MODEL [${data.model}]...`,
                        color: 'yellow',
                        animate: true,
                    });
                    addModelLine(data.model, {
                        text: '> INGESTING NEWS CONTEXT + MARKET RULES...',
                        color: 'white',
                    });
                    addModelLine(data.model, {
                        text: '> INITIATING CHAIN OF THOUGHT...',
                        color: 'white',
                        animate: true,
                    });
                    setModelStatus(data.model, 'prompting');
                    break;

                case 'model_done':
                    if (data.success) {
                        addModelLine(data.model, {
                            text: '',
                            color: 'gray',
                        });
                        addModelLine(data.model, {
                            text: '> REASONING:',
                            color: 'cyan',
                        });

                        // Split reasoning into lines for readability
                        const reasoning = String(data.reasoning || '');
                        const chunks = reasoning.match(/.{1,80}(\s|$)/g) || [reasoning];
                        chunks.forEach((chunk: string) => {
                            addModelLine(data.model, {
                                text: `  ${chunk.trim()}`,
                                color: 'white',
                            });
                        });

                        addModelLine(data.model, { text: '', color: 'gray' });
                        addModelLine(data.model, {
                            text: `> VERDICT REACHED: ${data.selected_option}`,
                            color: 'green',
                        });

                        setModelStatus(data.model, 'done', data.selected_option);
                    } else {
                        addModelLine(data.model, {
                            text: `> ERROR: ${data.error}`,
                            color: 'red',
                        });
                        setModelStatus(data.model, 'error');
                    }
                    break;

                case 'consensus':
                    setConsensus({
                        resolved: data.resolved,
                        winner: data.winner,
                        voteCounts: data.voteCounts,
                        totalVotes: data.totalVotes,
                    });

                    if (data.resolved) {
                        addGlobalLine({
                            text: `> CONSENSUS ACHIEVED: ${data.winner}`,
                            color: 'green',
                        });
                        addGlobalLine({
                            text: `> VOTES: ${JSON.stringify(data.voteCounts)} (${data.totalVotes} total)`,
                            color: 'white',
                        });
                    } else {
                        addGlobalLine({
                            text: '> CONSENSUS NOT REACHED',
                            color: 'red',
                        });
                    }
                    break;

                case 'chain_status':
                    setChainStatus(data.status);
                    if (data.status === 'confirmed') {
                        addGlobalLine({
                            text: `> TX CONFIRMED: ${data.txHash}`,
                            color: 'green',
                        });
                        setConsensus((prev) =>
                            prev ? { ...prev, txHash: data.txHash } : prev
                        );
                    }
                    break;

                case 'complete':
                    setShowOverlay(true);
                    if (data.winner) {
                        setConsensus((prev) =>
                            prev
                                ? { ...prev, txHash: data.txHash, winner: data.winner }
                                : {
                                    resolved: true,
                                    winner: data.winner,
                                    voteCounts: {},
                                    totalVotes: 0,
                                    txHash: data.txHash,
                                }
                        );
                    }
                    setTimeout(() => {
                        onComplete(data.winner || null);
                    }, 5000);
                    break;

                case 'error':
                    addGlobalLine({
                        text: `> FATAL ERROR: ${data.message}`,
                        color: 'red',
                    });
                    break;
            }
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [addGlobalLine, addModelLine, setModelStatus, onComplete]
    );

    // Keep ref in sync with latest handleSSEEvent
    useEffect(() => {
        handleSSEEventRef.current = handleSSEEvent;
    }, [handleSSEEvent]);

    // ─── Start SSE connection ───────────────────────────────────────
    useEffect(() => {
        const controller = new AbortController();
        abortRef.current = controller;

        // Clear any stale state from previous mount (React Strict Mode)
        setGlobalLines([]);
        setModelStates((prev) => {
            const reset: Record<string, ModelState> = {};
            for (const key of Object.keys(prev)) {
                reset[key] = { lines: [], verdict: null, status: 'idle' };
            }
            return reset;
        });
        setPhase('idle');
        setConsensus(null);
        setShowOverlay(false);
        setChainStatus(null);

        // Boot animation, then connect
        const bootSequence = async () => {
            const bootSteps = [
                '> CONNECTING TO CHAINLINK DON...',
                '> REGISTERING WORKFLOW TRIGGER...',
                '> INITIALIZING HTTP CAPABILITY...',
                '> LOADING AI COMMITTEE MODELS...',
                '> SWARM NODES SYNCHRONIZED',
            ];

            for (const step of bootSteps) {
                if (controller.signal.aborted) return;
                addGlobalLine({ text: step, color: 'cyan' });
                await new Promise((r) => setTimeout(r, 400 + Math.random() * 300));
            }

            if (controller.signal.aborted) return;

            addGlobalLine({ text: '', color: 'gray' });
            addGlobalLine({
                text: '─────────────────────────────────',
                color: 'gray',
            });
            addGlobalLine({ text: '', color: 'gray' });

            // Start SSE
            try {
                const res = await fetch('/api/consensus', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ market }),
                    signal: controller.signal,
                });


                if (!res.ok || !res.body) {
                    addGlobalLine({
                        text: `> ERROR: API returned ${res.status}`,
                        color: 'red',
                    });
                    return;
                }

                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    const chunk = decoder.decode(value, { stream: true });
                    buffer += chunk;
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        if (!line.startsWith('data: ')) continue;
                        try {
                            const data = JSON.parse(line.slice(6));
                            handleSSEEventRef.current(data);
                        } catch {
                            // ignore parse errors
                        }
                    }
                }
            } catch (err: unknown) {
                if (err instanceof Error && err.name !== 'AbortError') {
                    addGlobalLine({
                        text: `> CONNECTION ERROR: ${err.message}`,
                        color: 'red',
                    });
                }
            }
        };

        bootSequence();

        return () => {
            controller.abort();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // (handleSSEEvent moved above useEffect — see above)

    // ─── Layout math ────────────────────────────────────────────────
    const count = models.length;
    let gridClass = 'grid-cols-1';
    if (count === 2) gridClass = 'grid-cols-2';
    if (count === 3) gridClass = 'grid-cols-2';
    if (count >= 4) gridClass = 'grid-cols-2 grid-rows-2';

    // ─── Color mapping ──────────────────────────────────────────────
    const colorMap: Record<string, string> = {
        white: 'text-white',
        gray: 'text-gray-600',
        green: 'text-green',
        red: 'text-red',
        yellow: 'text-white',
        cyan: 'text-green',
    };

    // Status dot color per model
    const statusDot = (status: ModelState['status']) => {
        switch (status) {
            case 'prompting':
                return 'bg-yellow-400 animate-pulse';
            case 'done':
                return 'bg-green';
            case 'error':
                return 'bg-red';
            default:
                return 'bg-gray-600';
        }
    };

    return (
        <div className="relative w-full h-[calc(100vh-4rem)] bg-black p-4">
            <div
                className={`w-full h-full grid gap-4 ${gridClass} animate-in zoom-in-95 duration-500`}
            >
                {models.map((model, i) => {
                    const state = modelStates[model.name];
                    const lines = state?.lines || [];

                    return (
                        <div
                            key={model.name}
                            className={`border border-white p-4 font-mono flex flex-col overflow-hidden relative ${count === 3 && i === 2 ? 'col-span-2' : ''
                                }`}
                        >
                            {/* Terminal header */}
                            {(() => {
                                const provider = getProviderName(model.name);
                                return (
                                    <div className="border-b border-gray-800 pb-3 mb-4">
                                        <div className="flex items-center justify-between mb-1">
                                            <span className="text-lg font-bold tracking-wide text-green">
                                                {provider}
                                            </span>
                                            <span
                                                className={`w-3 h-3 ${statusDot(state?.status || 'idle')}`}
                                            />
                                        </div>
                                        <div className="text-xs tracking-widest uppercase text-gray-500">
                                            MODEL: {model.name}
                                        </div>
                                    </div>
                                );
                            })()}

                            {/* Terminal content */}
                            <div
                                ref={(el) => {
                                    terminalRefs.current[model.name] = el;
                                }}
                                className="flex flex-col gap-1 text-sm flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-800"
                            >
                                {lines.map((line, idx) => (
                                    <div
                                        key={idx}
                                        className={`${colorMap[line.color] || 'text-white'} ${line.animate ? 'animate-pulse' : ''
                                            } leading-relaxed break-words`}
                                    >
                                        {line.text || '\u00A0'}
                                    </div>
                                ))}

                                {/* Verdict badge */}
                                {state?.verdict && (
                                    <div className="mt-4 border-t border-gray-800 pt-4">
                                        <div className="inline-block border-2 border-green px-4 py-2 text-green font-bold tracking-widest">
                                            ✓ {state.verdict}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Global Consensus Overlay */}
            {showOverlay && consensus && (
                <div className="absolute inset-0 bg-black/95 flex flex-col items-center justify-center animate-in fade-in zoom-in-95 duration-700 z-50">
                    <div className="text-gray-500 font-mono tracking-[0.3em] uppercase text-sm mb-2">
                        Chainlink CRE Consensus
                    </div>
                    <h2 className="text-gray-400 font-mono tracking-widest uppercase mb-6 text-xl">
                        {consensus.resolved
                            ? 'Global Consensus Achieved'
                            : 'Consensus Not Reached'}
                    </h2>

                    {consensus.winner && (
                        <div className="text-6xl font-bold tracking-tighter text-green text-center px-8 mb-6 animate-in slide-in-from-bottom duration-500">
                            {consensus.winner}
                        </div>
                    )}

                    {/* Vote breakdown */}
                    <div className="font-mono text-sm text-gray-400 mb-8 text-center">
                        {Object.entries(consensus.voteCounts).map(
                            ([option, count]) => (
                                <div key={option} className="mb-1">
                                    {option}:{' '}
                                    <span
                                        className={
                                            option === consensus.winner
                                                ? 'text-green font-bold'
                                                : 'text-white'
                                        }
                                    >
                                        {count}/{consensus.totalVotes} votes
                                    </span>
                                </div>
                            )
                        )}
                    </div>

                    {/* Chain write status */}
                    {chainStatus === 'confirmed' && consensus.txHash ? (
                        <div className="text-center">
                            <p className="font-mono tracking-widest uppercase text-green border border-green px-6 py-2 mb-4">
                                ✓ Voted on UMA Network
                            </p>
                            <p className="font-mono text-xs text-gray-600 break-all max-w-md">
                                TX: {consensus.txHash}
                            </p>
                        </div>
                    ) : (
                        <p className="font-mono tracking-widest uppercase text-white animate-pulse border border-white px-6 py-2">
                            Executing Transaction...
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}
