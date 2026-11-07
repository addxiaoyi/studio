import type {MotionTrack} from "@helstera/shared";

export function StudioMotionPreview({tracks,english}:{tracks:MotionTrack[];english:boolean}){
  return <div className="mt-2 space-y-2">{tracks.map(track=>{
    const maxTime=Math.max(...track.points.map(point=>point.timeMs),1),values=track.points.map(point=>point.value);
    const min=Math.min(...values),range=Math.max(0.001,Math.max(...values)-min);
    const points=track.points.map(point=>({x:12+point.timeMs/maxTime*276,y:58-(point.value-min)/range*44,...point}));
    return <figure key={track.property} className="rounded border bg-muted/30 p-2"><figcaption className="text-xs">{english?track.property:{opacity:"透明度",x:"水平位移",y:"垂直位移",scale:"缩放",rotation:"旋转"}[track.property]}</figcaption>
      <svg viewBox="0 0 300 72" role="img" aria-label={points.map(point=>`${point.timeMs/1000}s: ${point.value}`).join(", ")} className="mt-1 h-20 w-full text-primary"><path d="M12 58H288" fill="none" stroke="currentColor" strokeOpacity="0.2"/><polyline points={points.map(point=>`${point.x},${point.y}`).join(" ")} fill="none" stroke="currentColor" strokeWidth="2"/>{points.map(point=><circle key={point.timeMs} cx={point.x} cy={point.y} r="3" fill="currentColor"><title>{point.timeMs/1000}s · {point.value} · {point.ease}</title></circle>)}</svg>
      <p className="text-[11px] text-muted-foreground">{english?"Markers show keyframes. Segment easing is applied during playback.":"圆点表示关键帧；实际播放按所选缓动计算。"}</p></figure>;
  })}</div>;
}
