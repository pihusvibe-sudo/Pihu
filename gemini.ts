const API = "https://generativelanguage.googleapis.com/v1beta/models/";
const MODEL = "gemini-2.5-flash";
export async function askGemini(key:string, prompt:string, history:{role:"user"|"model";text:string}[]) {
 if(!key) throw new Error("Settings में Gemini API key जोड़ो।");
 const contents=[...history.slice(-12).map(m=>({role:m.role,parts:[{text:m.text}]})),{role:"user",parts:[{text:prompt}]}];
 const r=await fetch(`${API}${MODEL}:generateContent?key=${encodeURIComponent(key)}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({systemInstruction:{parts:[{text:"You are Pihu, a friendly, witty and helpful personal AI companion. Reply naturally in Hindi, English or Hinglish matching the user. Be honest about limitations. Do not claim physical robot control."}]},contents,generationConfig:{temperature:0.7,maxOutputTokens:700}})});
 const d=await r.json(); if(!r.ok) throw new Error(d?.error?.message||`Gemini error ${r.status}`);
 const a=d?.candidates?.[0]?.content?.parts?.map((p:any)=>p.text||"").join("").trim(); if(!a) throw new Error("Gemini returned no answer."); return a;
}
export async function visionGemini(key:string,base64:string){
 if(!key) throw new Error("Settings में Gemini API key जोड़ो।");
 const r=await fetch(`${API}${MODEL}:generateContent?key=${encodeURIComponent(key)}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{role:"user",parts:[{text:"Describe visible objects and the scene for the user. Do not identify people or infer sensitive traits."},{inline_data:{mime_type:"image/jpeg",data:base64}}]}],generationConfig:{maxOutputTokens:400}})});
 const d=await r.json(); if(!r.ok) throw new Error(d?.error?.message||`Gemini error ${r.status}`);
 return d?.candidates?.[0]?.content?.parts?.map((p:any)=>p.text||"").join("").trim()||"No description returned.";
}