/** Critically damped response: no stationary shots or long fixed-speed backlog. */
export function advanceScroll(current:number,target:number,velocity:number,dt:number){
 const smoothTime=.2,maxSpeed=.18,omega=2/smoothTime,x=omega*dt;
 const decay=1/(1+x+.48*x*x+.235*x*x*x);
 const change=Math.max(-maxSpeed*smoothTime,Math.min(maxSpeed*smoothTime,current-target));
 const adjusted=current-change,temp=(velocity+omega*change)*dt;
 let nextVelocity=(velocity-omega*temp)*decay;
 let value=adjusted+(change+temp)*decay;
 if((target-current>0)===(value>target)){value=target;nextVelocity=0;}
 return {value,velocity:nextVelocity};
}
