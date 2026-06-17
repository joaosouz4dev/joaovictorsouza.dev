import { defineConfig, transformWithOxc } from 'vite';
import react from '@vitejs/plugin-react';

const manualChunkGroups = {
  vendor: ['react', 'react-dom', 'react-router-dom'],
  i18n: ['i18next', 'react-i18next', 'i18next-browser-languagedetector'],
  motion: ['framer-motion'],
  lenis: ['lenis'],
  icons: ['lucide-react'],
};

function manualChunks(id) {
  const normalizedId = id.replace(/\\/g, '/');

  if (!normalizedId.includes('/node_modules/')) {
    return undefined;
  }

  for (const [chunkName, dependencies] of Object.entries(manualChunkGroups)) {
    if (dependencies.some((dependency) => normalizedId.includes(`/node_modules/${dependency}/`))) {
      return chunkName;
    }
  }

  return undefined;
}

function jsxInJsPlugin() {
  return {
    name: 'jsx-in-js',
    enforce: 'pre',
    async transform(code, id) {
      const [filepath] = id.split('?');

      if (!/[\\/]src[\\/].*\.(js|jsx)$/.test(filepath)) {
        return null;
      }

      const result = await transformWithOxc(code, filepath, {
        lang: 'jsx',
        jsx: {
          runtime: 'automatic',
        },
        sourcemap: this.environment?.mode !== 'build',
      });

      return {
        code: result.code,
        map: result.map,
        moduleType: 'js',
      };
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    jsxInJsPlugin(),
    react({
      include: /\.(js|jsx|ts|tsx)$/,
    }),
  ],
  oxc: {
    include: /\.(js|jsx|ts|tsx)$/,
    exclude: /node_modules/,
    lang: 'jsx',
    jsx: {
      runtime: 'automatic',
    },
  },
  optimizeDeps: {
    rolldownOptions: {
      moduleTypes: {
        '.js': 'jsx',
      },
    },
  },
  server: {
    port: 3000,
    open: true,
  },
  build: {
    outDir: 'build',
    sourcemap: false,
    minify: 'esbuild',
    cssMinify: 'esbuild',
    rollupOptions: {
      moduleTypes: {
        '.js': 'jsx',
      },
      output: {
        manualChunks,
      },
    },
  },
  publicDir: 'public',
});
