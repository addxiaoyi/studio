import {sha256} from "@noble/hashes/sha256";

export const MEDIA_HASH_CHUNK_BYTES=1024*1024;

export async function mediaFileHash(file:Blob,signal?:AbortSignal):Promise<string> {
  const hash=sha256.create();
  try {
    for(let offset=0;offset<file.size;offset+=MEDIA_HASH_CHUNK_BYTES){
      signal?.throwIfAborted();
      const bytes=new Uint8Array(await file.slice(offset,offset+MEDIA_HASH_CHUNK_BYTES).arrayBuffer());
      signal?.throwIfAborted();hash.update(bytes);
      if(offset%(4*MEDIA_HASH_CHUNK_BYTES)===0)await new Promise<void>(resolve=>setTimeout(resolve,0));
    }
    signal?.throwIfAborted();
    return [...hash.digest()].map(byte=>byte.toString(16).padStart(2,"0")).join("");
  } finally {hash.destroy();}
}
