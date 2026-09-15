import {defineConfig} from 'vite';
export default defineConfig({
  server:{host:'127.0.0.1',port:5173,strictPort:true},
  preview:{host:'127.0.0.1',port:4173,strictPort:true},
  plugins:[{name:'binary-asset-mime',configureServer(server){server.middlewares.use((req,res,next)=>{if(req.url?.match(/\.(hdr|rgba16f\.gz|navmesh)(\?|$)/))res.setHeader('Content-Type','application/octet-stream');next()})}}],
  build:{chunkSizeWarningLimit:6000}
});
