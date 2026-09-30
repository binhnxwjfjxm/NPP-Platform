"use client";

import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import styles from "./McpFoundation.module.css";

export type McpSheetVariant = "default" | "compact" | "workspace";
type Props = { open:boolean; title:string; description?:string; children:ReactNode; footer?:ReactNode; onClose:()=>void; variant?:McpSheetVariant; };
const focusableSelector=["a[href]","button:not([disabled])","input:not([disabled])","select:not([disabled])","textarea:not([disabled])","[tabindex]:not([tabindex='-1'])"].join(",");

export function McpSheet({open,title,description,children,footer,onClose,variant="default"}:Props){
  const [mounted,setMounted]=useState(false); const titleId=useId(); const descriptionId=useId();
  const sheetRef=useRef<HTMLElement|null>(null); const onCloseRef=useRef(onClose);
  useEffect(()=>setMounted(true),[]); useEffect(()=>{onCloseRef.current=onClose;},[onClose]);
  useEffect(()=>{
    if(!mounted||!open)return;
    const body=document.body, html=document.documentElement;
    const scrollRegion=document.querySelector<HTMLElement>("[data-mcp-scroll-region='true']");
    const scrollTop=scrollRegion?.scrollTop??0, windowScrollY=window.scrollY;
    const returnFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const previous={bodyOverflow:body.style.overflow,bodyOverscroll:body.style.overscrollBehavior,htmlOverflow:html.style.overflow,htmlOverscroll:html.style.overscrollBehavior,regionOverflow:scrollRegion?.style.overflow??"",regionOverscroll:scrollRegion?.style.overscrollBehavior??""};
    body.style.overflow="hidden"; body.style.overscrollBehavior="contain"; html.style.overflow="hidden"; html.style.overscrollBehavior="contain";
    if(scrollRegion){scrollRegion.style.overflow="hidden";scrollRegion.style.overscrollBehavior="contain";}
    const frame=window.requestAnimationFrame(()=>{sheetRef.current?.focus({preventScroll:true});if(scrollRegion)scrollRegion.scrollTop=scrollTop;});
    function keydown(event:KeyboardEvent){
      if(event.key==="Escape"){event.preventDefault();onCloseRef.current();return;}
      if(event.key!=="Tab"||!sheetRef.current)return;
      const focusable=Array.from(sheetRef.current.querySelectorAll<HTMLElement>(focusableSelector)).filter(el=>el.getClientRects().length>0);
      if(!focusable.length){event.preventDefault();sheetRef.current.focus({preventScroll:true});return;}
      const first=focusable[0],last=focusable[focusable.length-1],active=document.activeElement;
      if(!sheetRef.current.contains(active)){event.preventDefault();(event.shiftKey?last:first).focus({preventScroll:true});}
      else if(event.shiftKey&&active===first){event.preventDefault();last.focus({preventScroll:true});}
      else if(!event.shiftKey&&active===last){event.preventDefault();first.focus({preventScroll:true});}
    }
    document.addEventListener("keydown",keydown);
    return()=>{window.cancelAnimationFrame(frame);document.removeEventListener("keydown",keydown);body.style.overflow=previous.bodyOverflow;body.style.overscrollBehavior=previous.bodyOverscroll;html.style.overflow=previous.htmlOverflow;html.style.overscrollBehavior=previous.htmlOverscroll;if(scrollRegion){scrollRegion.style.overflow=previous.regionOverflow;scrollRegion.style.overscrollBehavior=previous.regionOverscroll;scrollRegion.scrollTop=scrollTop;}window.scrollTo(0,windowScrollY);window.requestAnimationFrame(()=>returnFocus?.focus({preventScroll:true}));};
  },[mounted,open]);
  if(!mounted||!open)return null;
  const sheetVariant=variant==="compact"?styles.sheetCompact:variant==="workspace"?styles.sheetWorkspace:"";
  const headerVariant=variant==="compact"?styles.sheetHeaderCompact:variant==="workspace"?styles.sheetHeaderWorkspace:"";
  const bodyVariant=variant==="compact"?styles.sheetBodyCompact:variant==="workspace"?styles.sheetBodyWorkspace:"";
  const footerVariant=variant==="compact"?styles.sheetFooterCompact:variant==="workspace"?styles.sheetFooterWorkspace:"";
  function backdrop(event:MouseEvent<HTMLDivElement>){if(variant!=="workspace"&&event.target===event.currentTarget)onCloseRef.current();}
  return createPortal(<div className={[styles.sheetBackdrop,variant==="workspace"?styles.sheetBackdropWorkspace:""].filter(Boolean).join(" ")} data-mcp-sheet-backdrop="true" onMouseDown={backdrop} role="presentation"><section ref={sheetRef} className={[styles.sheet,sheetVariant].filter(Boolean).join(" ")} data-mcp-sheet="true" data-variant={variant} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description?descriptionId:undefined} tabIndex={-1}>{variant==="workspace"?null:<div className={styles.sheetHandle} aria-hidden="true"/>}<header className={[styles.sheetHeader,headerVariant].filter(Boolean).join(" ")}><div className={styles.sheetHeading}><h2 className={styles.sheetTitle} id={titleId}>{title}</h2>{description?<p className={styles.sheetDescription} id={descriptionId}>{description}</p>:null}</div><button className={styles.sheetClose} type="button" aria-label="Đóng" onClick={()=>onCloseRef.current()}>×</button></header><div className={[styles.sheetBody,bodyVariant].filter(Boolean).join(" ")}>{children}</div>{footer?<footer className={[styles.sheetFooter,footerVariant].filter(Boolean).join(" ")}>{footer}</footer>:null}</section></div>,document.body);
}
