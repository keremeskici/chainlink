'use client';

import { useState, useEffect } from 'react';

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';

interface CyberTextProps {
    children: string | number;
    speed?: number;
    delay?: number;
    className?: string;
    as?: React.ElementType;
}

export function CyberText({ children, speed = 50, delay = 0, className = '', as: Component = 'span' }: CyberTextProps) {
    const [displayText, setDisplayText] = useState('');
    const [isStarted, setIsStarted] = useState(delay === 0);

    const text = String(children);

    useEffect(() => {
        if (delay > 0) {
            const timer = setTimeout(() => setIsStarted(true), delay);
            return () => clearTimeout(timer);
        }
        setIsStarted(true);
    }, [delay]);

    useEffect(() => {
        if (!isStarted) {
            setDisplayText('');
            return;
        }

        let iteration = 0;
        const totalIterations = 5; // Number of scramble cycles before revealing

        const interval = setInterval(() => {
            setDisplayText(() => {
                return text
                    .split('')
                    .map((char) => {
                        // Reveal original character when iterations are complete
                        if (iteration >= totalIterations) {
                            return char;
                        }
                        // Keep spaces as spaces
                        if (char === ' ') return ' ';
                        // Otherwise randomize
                        return CHARS[Math.floor(Math.random() * CHARS.length)];
                    })
                    .join('');
            });

            if (iteration >= totalIterations) {
                clearInterval(interval);
                setDisplayText(text); // ensure final text is exact
            }

            iteration++;
        }, speed);

        return () => clearInterval(interval);
    }, [text, speed, isStarted]);

    return <Component className={className}>{displayText}</Component>;
}
