'use client';

import { useEffect, useState, useCallback } from 'react';
import { fetchHistoricalMarkets, getActiveModels, Market } from '@/app/actions/polymarket';
import { MarketAnalysis } from '@/components/MarketAnalysis';
import { TerminalGrid, ModelParams } from '@/components/TerminalGrid';

type ViewState = 'LIST' | 'ANALYSIS' | 'CONSENSUS' | 'COMPLETE';

export default function MarketsPage() {
    const [viewState, setViewState] = useState<ViewState>('LIST');
    const [markets, setMarkets] = useState<Market[]>([]);
    const [selectedMarket, setSelectedMarket] = useState<Market | null>(null);
    const [models, setModels] = useState<ModelParams[]>([]);
    const [loading, setLoading] = useState(true);
    const [resolvedMarkets, setResolvedMarkets] = useState<Map<string, string>>(new Map());
    const [lastWinner, setLastWinner] = useState<string | null>(null);

    useEffect(() => {
        async function init() {
            const [fetchedMarkets, fetchedModels] = await Promise.all([
                fetchHistoricalMarkets(),
                getActiveModels()
            ]);
            setMarkets(fetchedMarkets);
            setModels(fetchedModels);
            setLoading(false);
        }
        init();
    }, []);

    const handleSelectMarket = (market: Market) => {
        setSelectedMarket(market);
        setViewState('ANALYSIS');
    };

    const handleInitiateConsensus = useCallback(() => {
        if (!selectedMarket) return;
        setViewState('CONSENSUS');
    }, [selectedMarket]);

    const handleConsensusComplete = useCallback((winner: string | null) => {
        if (selectedMarket && winner) {
            setResolvedMarkets((prev) => {
                const next = new Map(prev);
                next.set(selectedMarket.id, winner);
                return next;
            });
        }
        setLastWinner(winner);
        setViewState('COMPLETE');
    }, [selectedMarket]);

    const handleBackToList = () => {
        setViewState('LIST');
        setSelectedMarket(null);
        setLastWinner(null);
    };

    if (loading) {
        return (
            <div className="p-6 flex items-center justify-center min-h-[50vh]">
                <div className="text-white font-mono animate-pulse tracking-widest uppercase">
                    &gt; Loading Historical Markets...
                </div>
            </div>
        );
    }

    return (
        <div className="w-full">
            {viewState === 'LIST' && (
                <div className="p-6 max-w-4xl mx-auto animate-in fade-in duration-500">
                    <h1 className="text-2xl font-bold mb-8 tracking-widest uppercase text-white border-b border-gray-800 pb-4">
                        Simulation Targets ({markets.length})
                    </h1>

                    {markets.length === 0 ? (
                        <div className="text-gray-500 font-mono tracking-widest border border-gray-800 p-8 text-center">
                            No historical markets returned or API Error.
                        </div>
                    ) : (
                        markets.map((market) => {
                            const resolved = resolvedMarkets.get(market.id);
                            return (
                                <div
                                    key={market.id}
                                    onClick={() => handleSelectMarket(market)}
                                    className={`group border p-6 mb-6 transition-all cursor-pointer bg-black ${resolved
                                            ? 'border-green hover:border-green/80 hover:bg-[#050505]'
                                            : 'border-white hover:border-green hover:bg-[#050505]'
                                        }`}
                                >
                                    <div className="flex items-start justify-between gap-4">
                                        <h2 className={`text-xl mb-4 transition-colors leading-relaxed ${resolved
                                                ? 'text-green'
                                                : 'text-white group-hover:text-green'
                                            }`}>
                                            {market.question}
                                        </h2>
                                        {resolved && (
                                            <span className="shrink-0 border border-green text-green px-3 py-1 text-xs font-bold uppercase tracking-widest">
                                                Resolved
                                            </span>
                                        )}
                                    </div>

                                    <div className="flex justify-between font-mono text-sm text-gray-400 border-t border-gray-800 pt-4 mt-4">
                                        <span className="truncate mr-4">ID: {market.id}</span>
                                        <span className="shrink-0 flex items-center gap-4">
                                            {resolved && (
                                                <span className="text-green flex items-center gap-2">
                                                    <span className="w-2 h-2 bg-green" />
                                                    {resolved}
                                                </span>
                                            )}
                                            <span className="flex items-center gap-2">
                                                <span className={`w-2 h-2 ${resolved ? 'bg-green' : 'bg-white'}`} />
                                                Vol: {market.volume}
                                            </span>
                                        </span>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            )}

            {viewState === 'ANALYSIS' && selectedMarket && (
                <MarketAnalysis
                    market={selectedMarket}
                    onInitiate={handleInitiateConsensus}
                    onBack={handleBackToList}
                    resolved={resolvedMarkets.get(selectedMarket.id)}
                />
            )}

            {viewState === 'CONSENSUS' && selectedMarket && (
                <TerminalGrid
                    models={models}
                    market={selectedMarket}
                    onComplete={handleConsensusComplete}
                />
            )}

            {viewState === 'COMPLETE' && (
                <div className="p-6 flex flex-col items-center justify-center min-h-[50vh] animate-in zoom-in duration-500">
                    <div className="border border-green p-12 text-center bg-black max-w-2xl w-full">
                        <div className="text-gray-500 font-mono tracking-[0.3em] uppercase text-xs mb-4">
                            SwarmOracle Protocol
                        </div>
                        <h2 className="text-3xl font-bold tracking-widest uppercase text-green mb-4">
                            Consensus Complete
                        </h2>

                        {lastWinner && (
                            <div className="border-2 border-green px-8 py-4 mb-6 inline-block">
                                <span className="text-green text-2xl font-bold tracking-wider">
                                    {lastWinner}
                                </span>
                            </div>
                        )}

                        <p className="font-mono text-gray-400 mb-8 text-sm">
                            Verdict recorded on UMA Network via OracleRegistry.recordVerdict()
                        </p>

                        <button
                            onClick={handleBackToList}
                            className="px-8 py-4 bg-white text-black font-bold uppercase tracking-widest hover:bg-green hover:text-black transition-colors"
                        >
                            Return to Markets
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
