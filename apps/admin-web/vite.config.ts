import react from '@vitejs/plugin-react';
import {defineConfig} from 'vitest/config';
import {fileURLToPath,URL} from 'node:url';

export default defineConfig({
  base:'./',
  publicDir:'../web/public',
  plugins:[react()],
  resolve:{dedupe:['react','react-dom'],alias:{
    react:fileURLToPath(new URL('./node_modules/react',import.meta.url)),
    'react-dom':fileURLToPath(new URL('./node_modules/react-dom',import.meta.url))
  }},
  test:{environment:'jsdom',setupFiles:['src/testSetup.ts'],include:['src/**/*.test.ts','src/**/*.test.tsx']},
  server:{host:'127.0.0.1',port:4183,strictPort:true,proxy:{'/api':'http://127.0.0.1:4192'}},
  preview:{host:'127.0.0.1',port:4183,strictPort:true,proxy:{'/api':'http://127.0.0.1:4192'}}
});

