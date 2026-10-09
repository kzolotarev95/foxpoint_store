"use client";
import {useState} from "react";
export function AdminCopyContact({value}:{value:string}) {
  const [message,setMessage]=useState("");
  return <span><button className="secondaryButton" type="button" onClick={async()=>{try{await navigator.clipboard.writeText(value);setMessage("Контакт скопирован");}catch{setMessage("Выделите контакт и скопируйте вручную");}}}>Копировать контакт</button> <small role="status">{message}</small></span>;
}
