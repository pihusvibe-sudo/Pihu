import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
export type Msg={role:"user"|"model";text:string;time:number};
export type Person={id:string;name:string;photo:string;note:string};
export const getKey=()=>SecureStore.getItemAsync("gemini_key");
export const putKey=(v:string)=>SecureStore.setItemAsync("gemini_key",v.trim());
export async function load<T>(k:string,f:T):Promise<T>{try{return JSON.parse((await AsyncStorage.getItem(k))||"null")??f}catch{return f}}
export const save=(k:string,v:any)=>AsyncStorage.setItem(k,JSON.stringify(v));
