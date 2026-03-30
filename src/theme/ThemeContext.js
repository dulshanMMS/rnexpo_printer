import React, { createContext, useContext } from 'react';

const ThemeContext = createContext({
    colors: {
        background: '#f6f3ec',
        surface: '#fffdf8',
        textPrimary: '#1f1b16',
        textSecondary: '#6f6457',
        accent: '#006a4e',
        accentSoft: '#d6f2e8',
        warning: '#a83f00',
        border: '#ddd2c2',
        success: '#147d3f',
        error: '#b42318'
    }
});

export function ThemeProvider({ children }) {
    const colors = {
        background: '#f6f3ec',
        surface: '#fffdf8',
        textPrimary: '#1f1b16',
        textSecondary: '#6f6457',
        accent: '#006a4e',
        accentSoft: '#d6f2e8',
        warning: '#a83f00',
        border: '#ddd2c2',
        success: '#147d3f',
        error: '#b42318'
    };

    return <ThemeContext.Provider value={{ colors }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
    return useContext(ThemeContext);
}
