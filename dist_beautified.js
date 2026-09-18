import{
  r,f as O,K as He,j as e,i as te,L as V,I as We,F as Y,X as ee,S as Se,m as we,d as Qe,p as _e,U as Be,q as ve,T as ye,v as Ce,O as Ze,J as pe,g as Ke,H as Xe
}from"./index-BDM0BjIU.js";
import{
  U as Ge
}from"./upload-BbrEpbhc.js";
import{
  T as Ie
}from"./trending-up-T0dgbCM1.js";
import{
  C as Ve
}from"./circle-check-BdN_gKfa.js";
import{
  C as Fe
}from"./clock-1pPffxf4.js";
import{
  C as Ye
}from"./circle-alert-Di8gJYSJ.js";
import{
  C as et
}from"./calendar-DHIdhV93.js";
import{
  C as tt
}from"./cpu-p6QvtfFd.js";
function I(a,u,S,g,y=73.4,x=1e3,p){
  let F=4,c=25;
  const j=S.match(/(\d+)\s*\*?\s*(\d+(\.\d+)?)/);
  j&&(F=parseInt(j[1]),c=parseFloat(j[2]));
  const o=parseFloat((F*c*8.89*1.02/1e3).toFixed(3)),f=parseFloat((o*y).toFixed(2)),v=parseFloat((g-f).toFixed(2)),h=c>=50?45:c>=25?28:c>=16?22:1.8;
  let n="reasonable";
  v<h*.9?n="low":v>h*1.3&&(n="high");
  const N=parseFloat((o+c*.036).toFixed(3)),k=parseFloat((N*x/1e3).toFixed(2)),w=p||parseFloat((k*(1+(Math.random()*.04-.02))).toFixed(2)),$=parseFloat((Math.abs(w-k)/k*100).toFixed(1)),X=$>5?"异常":"合理",H=5,W=new Date(Date.now()+H*24*60*60*1e3).toISOString().split("T")[0],E=3,M=new Date(Date.now()+E*24*60*60*1e3).toISOString().split("T")[0],se="adequate",R=c>=16?"挤塑3号线":"绞线1号线",b=c>=16?"Ext-03":"Strand-01",ae=c>=16?98:95,le=`物理能力符合。该机台上一个加工规格为 ${
    S
  }，属于同系列规格，换产无需洗机和更换大拉丝模具，可节省调车调试时间 30 分钟。`,Q="建议插单在当前正在加工的订单 SO-045 之后，SO-048 之前。";
  let U="良好",q="AA",L=2e6,z=234e3,J=0;
  return a.includes("比亚迪")?(U="预警",q="A",L=3e6,z=185e4,J=15e4):a.includes("烂尾楼")?(U="严重超期",q="D",L=5e5,z=48e4,J=32e4):a.includes("华为")&&(U="良好",q="AAA",L=5e6,z=12e5,J=0),{
    customer_risk:{
      credit_limit:L,outstanding_balance:z,overdue_amount:J,credit_status:U,risk_level:q,stock_available:c>=25?800:c>=16?0:35e3
    },price_breakdown:{
      copper_cost:f,processing_fee:v,standard_fee:h,price_status:n
    },weight_check:{
      extracted_weight:w,theoretical_weight:k,deviation_rate:$,status:X
    },delivery_check:{
      requested_date:W,earliest_finish_date:M,status:se
    },scheduling:{
      machine_id:b,machine_name:R,score:ae,reason:le,suggested_sequence:Q
    }
  }
}function ke(a){
  try{
    const u=a.match(/```(?:json)?\s*([\s\S]*?)\s*```/),S=u?u[1]:a,g=JSON.parse(S);
    return(Array.isArray(g)?g:[g]).map(x=>{
      if(!x.match_1&&(x.material_match||x.analysis_conclusion)){
        const p={
          material_match:x.material_match||"",material_spec:x.material_spec||"",customer_purchase_record:x.customer_purchase_record||"",price_statistics:x.price_statistics||{
            max_price:"",min_price:"",avg_price:"",price_fluctuation:""
          },analysis_conclusion:x.analysis_conclusion||"",quote_suggestion:x.quote_suggestion||"无历史参考"
        };
        return{
          ...x,match_1:p,match_2:{
            ...p,material_match:"无第二匹配方案"
          },match_3:{
            ...p,material_match:"无第三匹配方案"
          }
        }
      }return x
    })
  }catch(u){
    return console.warn("JSON parse error:",u),[]
  }
}const fe=({
  num:a,m:u,activeMatch:S,onSelect:g
})=>{
  if(!u)return null;
  const y=S===a;
  return e.jsxs("div",{
    className:`flex items-center gap-3 p-4 rounded-xl border transition-all cursor-pointer select-none
                ${
      y?"bg-emerald-50 border-emerald-400 shadow-md ring-2 ring-emerald-500/20":"bg-white border-slate-100 hover:border-emerald-200 hover:bg-slate-50"
    }`,onClick:x=>{
      x.stopPropagation(),g(a)
    },children:[e.jsx("div",{
      className:`w-6 h-6 rounded-md flex items-center justify-center font-black text-xs shrink-0
                ${
        y?"bg-emerald-500 text-white":"bg-slate-100 text-slate-400"
      }`,children:a
    }),e.jsxs("div",{
      className:"flex-1 min-w-0",children:[e.jsxs("div",{
        className:"text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-0.5",children:["匹配结果 ",a]
      }),e.jsx("div",{
        className:"text-sm font-black text-slate-700 truncate",children:u.material_match||"未命中"
      }),e.jsx("div",{
        className:"text-xs text-slate-500 font-medium truncate",children:u.material_spec||"-"
      })]
    }),y&&e.jsx("div",{
      className:"w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0"
    })]
  })
},st=({
  item:a,idx:u,isExpanded:S,onToggle:g,baseCopperPrice:y,onOpenCustomerProfile:x
})=>{
  const[p,F]=r.useState(1);
  if(!a)return null;
  const c=a[`match_${
    p
  }`],j=I(a.customer_name||"未知客户",a.material_no||"",c?.material_spec||c?.material_match||"4*25",Number(a.unit_price||0),y,a.length_m||1e3,a.extracted_weight_t),o={
    ...c,customer_risk:c?.customer_risk||j.customer_risk,price_breakdown:c?.price_breakdown||j.price_breakdown,weight_check:c?.weight_check||j.weight_check,delivery_check:c?.delivery_check||j.delivery_check,scheduling:c?.scheduling||j.scheduling
  },f=o.price_breakdown,v=o.weight_check,h=o.delivery_check,n=o.scheduling,N=f.copper_cost+f.processing_fee,k=N>0?Math.round(f.copper_cost/N*100):70,w=100-k;
  return e.jsx("div",{
    className:"bg-white border border-slate-200/80 rounded-[2rem] shadow-xl overflow-hidden hover:border-emerald-200 transition-all duration-300",children:S?e.jsxs("div",{
      className:"grid grid-cols-12 min-h-[500px]",children:[e.jsxs("div",{
        className:"col-span-5 bg-slate-50/50 p-7 border-r border-slate-100 flex flex-col gap-6",children:[e.jsxs("div",{
          className:"flex items-center justify-between cursor-pointer group",onClick:g,children:[e.jsxs("div",{
            className:"flex items-center gap-4",children:[e.jsx("span",{
              className:"w-10 h-10 rounded-xl bg-slate-900 text-white flex items-center justify-center font-black text-lg shadow-lg shrink-0",children:u+1
            }),e.jsx("div",{
              children:e.jsx("h3",{
                className:"text-2xl font-black text-slate-900 tracking-tight group-hover:text-emerald-600 transition-colors",children:a.material_no
              })
            })]
          }),e.jsx("button",{
            className:"text-xs font-bold text-slate-400 bg-white border border-slate-200 px-3 py-1.5 rounded-lg shadow-sm hover:bg-slate-100 transition-colors",children:"收起详细"
          })]
        }),e.jsxs("div",{
          children:[e.jsx("p",{
            className:"text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2.5",children:"单据上识别的物料描述"
          }),e.jsx("div",{
            className:"bg-white p-4 rounded-2xl border border-slate-200 shadow-sm",children:e.jsx("p",{
              className:"text-base font-bold text-slate-800 leading-relaxed",children:a.material_recognize||"-"
            })
          })]
        }),e.jsxs("div",{
          className:"flex items-center justify-between bg-blue-600 rounded-2xl p-5 shadow-lg shadow-blue-600/20",children:[e.jsxs("div",{
            children:[e.jsx("p",{
              className:"text-[10px] font-black text-blue-200 uppercase tracking-widest mb-1",children:"提取单价 (单据原值)"
            }),e.jsxs("p",{
              className:"text-2xl font-black text-white",children:[e.jsx("span",{
                className:"text-sm font-normal mr-1",children:"¥"
              }),a.unit_price||"-"]
            })]
          }),e.jsx(te,{
            className:"w-8 h-8 text-blue-400/50"
          })]
        }),e.jsxs("div",{
          className:"bg-white border border-indigo-100 rounded-2xl p-4 shadow-sm flex items-center justify-between",children:[e.jsxs("div",{
            className:"flex items-center gap-3",children:[e.jsx("div",{
              className:"w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center",children:e.jsx(Ce,{
                className:"w-4.5 h-4.5 text-indigo-600"
              })
            }),e.jsxs("div",{
              children:[e.jsx("p",{
                className:"text-[10px] text-slate-400 font-bold tracking-wider",children:"风控等级 / 可用现货"
              }),e.jsxs("p",{
                className:"text-sm font-black text-slate-800",children:[e.jsxs("span",{
                  className:`mr-2 px-1.5 py-0.5 rounded text-[10px] ${
                    o.customer_risk?.credit_status==="良好"?"bg-emerald-50 text-emerald-600":o.customer_risk?.credit_status==="预警"?"bg-amber-50 text-amber-600":"bg-red-50 text-red-600"
                  }`,children:[o.customer_risk?.risk_level||"A","级"]
                }),o.customer_risk?.stock_available?`${
                  o.customer_risk.stock_available
                } 米`:"无现货"]
              })]
            })]
          }),e.jsx("button",{
            onClick:()=>x(o.customer_risk,a.material_no,o.material_spec||o.material_match),className:"text-xs font-bold text-indigo-600 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100/80 px-2.5 py-1.5 rounded-lg transition-colors",children:"画像抽屉"
          })]
        }),e.jsxs("div",{
          className:"space-y-3 mt-1",children:[e.jsx("p",{
            className:"text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] mb-1",children:"知识库匹配方案 (请选择)"
          }),e.jsx(fe,{
            num:1,m:a.match_1,activeMatch:p,onSelect:F
          }),e.jsx(fe,{
            num:2,m:a.match_2,activeMatch:p,onSelect:F
          }),e.jsx(fe,{
            num:3,m:a.match_3,activeMatch:p,onSelect:F
          })]
        })]
      }),e.jsxs("div",{
        className:"col-span-7 p-8 flex flex-col bg-white",children:[e.jsxs("div",{
          className:"flex-1 space-y-7",children:[e.jsxs("div",{
            children:[e.jsxs("div",{
              className:"flex items-center justify-between mb-3",children:[e.jsxs("div",{
                className:"flex items-center gap-2.5",children:[e.jsx(Ke,{
                  className:"w-5 h-5 text-slate-500"
                }),e.jsx("h4",{
                  className:"font-black text-base text-slate-800",children:"价格透视与加工费分析"
                })]
              }),e.jsx("span",{
                className:`px-2.5 py-1 rounded-full text-xs font-black border ${
                  f.price_status==="reasonable"?"bg-emerald-50 border-emerald-200 text-emerald-700":f.price_status==="low"?"bg-red-50 border-red-200 text-red-700":"bg-amber-50 border-amber-200 text-amber-700"
                }`,children:f.price_status==="reasonable"?"🟢 报价合理":f.price_status==="low"?"🔴 加工费偏低":"🟡 加工费偏高"
              })]
            }),e.jsxs("div",{
              className:"space-y-2",children:[e.jsxs("div",{
                className:"w-full h-7 rounded-lg overflow-hidden flex shadow-inner",children:[e.jsxs("div",{
                  className:"bg-blue-500 flex items-center justify-center text-[10px] text-white font-black",style:{
                    width:`${
                      k
                    }%`
                  },children:["铜成本 ",k,"%"]
                }),e.jsxs("div",{
                  className:"bg-amber-500 flex items-center justify-center text-[10px] text-white font-black",style:{
                    width:`${
                      w
                    }%`
                  },children:["加工费 ",w,"%"]
                })]
              }),e.jsxs("div",{
                className:"flex justify-between text-xs text-slate-400 font-bold px-1",children:[e.jsxs("span",{
                  children:["材料铜价: ¥",f.copper_cost,"/米"]
                }),e.jsxs("span",{
                  children:["折算加工费: ¥",f.processing_fee,"/米 (标准定额: ¥",f.standard_fee,")"]
                })]
              })]
            })]
          }),e.jsxs("div",{
            className:"grid grid-cols-2 gap-4",children:[e.jsxs("div",{
              className:"bg-slate-50 border border-slate-100 rounded-2xl p-4",children:[e.jsxs("div",{
                className:"flex items-center gap-2 mb-2",children:[e.jsx(Xe,{
                  className:"w-4 h-4 text-slate-400"
                }),e.jsx("span",{
                  className:"text-[11px] text-slate-400 font-bold uppercase tracking-wider",children:"重量偏离校验"
                })]
              }),e.jsxs("p",{
                className:"text-sm font-black text-slate-800",children:["单据重: ",e.jsxs("span",{
                  className:"text-slate-600",children:[v.extracted_weight," 吨"]
                })]
              }),e.jsxs("p",{
                className:"text-sm font-black text-slate-800",children:["理论重: ",e.jsxs("span",{
                  className:"text-slate-600",children:[v.theoretical_weight," 吨"]
                })]
              }),e.jsxs("div",{
                className:"mt-2 flex items-center gap-2",children:[e.jsxs("span",{
                  className:`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                    v.status==="合理"?"bg-emerald-50 text-emerald-600":"bg-red-50 text-red-600"
                  }`,children:["偏差 ",v.deviation_rate,"%"]
                }),e.jsx("span",{
                  className:"text-xs text-slate-400 font-bold",children:v.status==="合理"?"🟢 重量相符":"⚠️ 严重偏差"
                })]
              })]
            }),e.jsxs("div",{
              className:"bg-slate-50 border border-slate-100 rounded-2xl p-4",children:[e.jsxs("div",{
                className:"flex items-center gap-2 mb-2",children:[e.jsx(et,{
                  className:"w-4 h-4 text-slate-400"
                }),e.jsx("span",{
                  className:"text-[11px] text-slate-400 font-bold uppercase tracking-wider",children:"交付周期时钟"
                })]
              }),e.jsxs("p",{
                className:"text-xs font-bold text-slate-500",children:["客户交期: ",e.jsx("span",{
                  className:"text-slate-800 font-black",children:h.requested_date
                })]
              }),e.jsxs("p",{
                className:"text-xs font-bold text-slate-500 mt-1",children:["最早完工: ",e.jsx("span",{
                  className:"text-slate-800 font-black",children:h.earliest_finish_date
                })]
              }),e.jsxs("div",{
                className:"mt-2.5 flex items-center gap-2",children:[e.jsx("span",{
                  className:`w-2.5 h-2.5 rounded-full animate-pulse ${
                    h.status==="adequate"?"bg-emerald-500":h.status==="tight"?"bg-amber-500":"bg-red-500"
                  }`
                }),e.jsx("span",{
                  className:"text-xs font-black text-slate-600",children:h.status==="adequate"?"🟢 交期合理":h.status==="tight"?"🟡 交期紧张":"🔴 完工滞后"
                })]
              })]
            })]
          }),e.jsxs("div",{
            className:"bg-gradient-to-r from-emerald-50/50 to-teal-50/20 border border-emerald-100/50 rounded-2xl p-4.5",children:[e.jsxs("div",{
              className:"flex items-center justify-between mb-2",children:[e.jsxs("div",{
                className:"flex items-center gap-2 text-emerald-800",children:[e.jsx(tt,{
                  className:"w-4.5 h-4.5"
                }),e.jsx("h5",{
                  className:"font-black text-sm uppercase tracking-wide",children:"⚡ 智能排产推荐"
                })]
              }),e.jsxs("span",{
                className:"bg-emerald-500 text-white font-black text-[11px] px-2 py-0.5 rounded-full shadow-sm",children:["机台评分: ",n.score,"分"]
              })]
            }),e.jsxs("p",{
              className:"text-xs font-black text-slate-700 leading-relaxed mb-2",children:["推荐设备: ",e.jsx("strong",{
                className:"text-emerald-700 font-extrabold",children:n.machine_name
              })," | ",n.reason]
            }),e.jsxs("div",{
              className:"bg-white/80 p-2.5 rounded-xl border border-emerald-100/50 text-[11px] text-slate-500 font-bold leading-relaxed",children:["队列插单: ",n.suggested_sequence]
            })]
          }),e.jsxs("div",{
            children:[e.jsxs("div",{
              className:"flex items-center gap-2 mb-2",children:[e.jsx(Fe,{
                className:"w-4 h-4 text-slate-400"
              }),e.jsx("h4",{
                className:"font-bold text-xs text-slate-400 uppercase tracking-wider",children:"最近一次履约记录"
              })]
            }),e.jsx("div",{
              className:"bg-slate-50 rounded-xl p-3 border border-slate-100",children:e.jsx("p",{
                className:"text-xs font-bold text-slate-600 leading-relaxed",children:o.customer_purchase_record||"暂无详细记录"
              })
            })]
          })]
        }),e.jsx("div",{
          className:"mt-6 pt-5 border-t border-slate-100",children:e.jsxs("div",{
            className:"bg-gradient-to-br from-rose-50 to-orange-50 rounded-[1.5rem] p-5 border border-rose-100 shadow-inner relative overflow-hidden",children:[e.jsxs("div",{
              className:"flex items-start gap-4 relative z-10",children:[e.jsx("div",{
                className:"w-10 h-10 rounded-xl bg-white flex items-center justify-center shadow-sm shrink-0",children:e.jsx(Se,{
                  className:"w-5 h-5 text-rose-500"
                })
              }),e.jsxs("div",{
                children:[e.jsx("h4",{
                  className:"font-black text-xs text-rose-900 mb-1 uppercase tracking-wide",children:"AI 建议单价"
                }),e.jsx("p",{
                  className:"text-base font-black text-rose-700 leading-tight",children:o.quote_suggestion||"-"
                })]
              })]
            }),e.jsx(Ie,{
              className:"absolute -bottom-4 -right-4 w-20 h-20 text-rose-500/5 rotate-[-15deg]"
            })]
          })
        })]
      })]
    }):e.jsxs("div",{
      className:"flex flex-col sm:flex-row sm:items-center justify-between p-5 cursor-pointer bg-slate-50/50 hover:bg-emerald-50/50 transition-colors gap-4",onClick:g,children:[e.jsxs("div",{
        className:"flex items-center gap-4",children:[e.jsx("span",{
          className:"w-10 h-10 rounded-xl bg-slate-900 text-white flex items-center justify-center font-black text-lg shadow-lg shrink-0",children:u+1
        }),e.jsx("h3",{
          className:"text-xl font-black text-slate-900 tracking-tight",children:a.material_no
        })]
      }),e.jsx("div",{
        className:"flex-1 sm:px-8 overflow-hidden",children:e.jsxs("div",{
          className:"bg-white px-4 py-2.5 rounded-xl border border-slate-200 shadow-sm truncate flex items-center gap-3",children:[e.jsx("span",{
            className:"text-[10px] font-black text-slate-400 uppercase tracking-widest shrink-0 border-r border-slate-200 pr-3",children:"单据描述"
          }),e.jsx("p",{
            className:"text-sm font-bold text-slate-700 truncate",children:a.material_recognize||"-"
          })]
        })
      }),e.jsxs("div",{
        className:"flex items-center gap-3 shrink-0",children:[e.jsxs("span",{
          className:"bg-blue-50 text-blue-600 font-black text-xs px-2.5 py-1 rounded-lg border border-blue-100",children:["¥",a.unit_price,"/米"]
        }),e.jsx("button",{
          className:"text-emerald-600 hover:text-emerald-700 font-bold text-xs flex items-center gap-1 bg-emerald-50 px-3.5 py-2 rounded-xl border border-emerald-100",children:"展开分析明细"
        })]
      })]
    })
  })
},xt=()=>{
  const[a,u]=r.useState(null),[S,g]=r.useState(!1),[y,x]=r.useState(!1),[p,F]=r.useState(!1),[c,j]=r.useState(null),[o,f]=r.useState("image"),[v,h]=r.useState(""),[n,N]=r.useState(null),[k,w]=r.useState(""),[$,X]=r.useState([]),[H,W]=r.useState(null),[E,M]=r.useState(null),[se,R]=r.useState(!1),[b,ae]=r.useState(73.4),[le,Q]=r.useState(!1),[U,q]=r.useState("未知客户"),[L,z]=r.useState("-"),[J,Ee]=r.useState("-"),[_,Te]=r.useState(null),[re,be]=r.useState(!1),[ge,T]=r.useState(null),[ne,B]=r.useState({
    
  }),ce=async()=>{
    try{
      const s=await(await O("/api/material-quote/history")).json();
      s.success&&X(s.data)
    }catch(t){
      console.error("Fetch history error:",t)
    }
  };
  r.useEffect(()=>{
    ce()
  },[]),r.useEffect(()=>{
    B(n?n.reduce((t,s,m)=>({
      ...t,[m]:!0
    }),{
      
    }):{
      
    })
  },[n]);
  const De=()=>{
    if(!n)return;
    const t=n.every((s,m)=>ne[m]);
    B(t?{
      
    }:n.reduce((s,m,l)=>({
      ...s,[l]:!0
    }),{
      
    }))
  },Oe=t=>{
    B(s=>({
      ...s,[t]:!s[t]
    }))
  },G=r.useRef(null),je=r.useRef(null);
  r.useEffect(()=>{
    if(!a){
      M(null);
      return
    }const t=URL.createObjectURL(a);
    return M(t),()=>URL.revokeObjectURL(t)
  },[a]);
  const Pe=(t,s,m)=>{
    q(n?.[0]?.customer_name||"未知客户"),z(s),Ee(m),Te(t),Q(!0)
  },ie=r.useCallback(async t=>{
    u(t),h(""),N(null),w(""),j(null),W(null),T(null),x(!0);
    try{
      const s=new FormData;
      s.append("file",t);
      const l=await(await O(He,{
        method:"POST",body:s
      })).json();
      if(l.id){
        j(l.id);
        const P=l.mimetype==="application/pdf"?"document":"image";
        f(P),l.localUrl&&M(l.localUrl)
      }else w("文件上传失败："+(l.error||JSON.stringify(l)))
    }catch(s){
      w("文件上传出错："+(s instanceof Error?s.message:String(s)))
    }finally{
      x(!1)
    }
  },[]),Ae=r.useCallback(t=>{
    t.preventDefault(),g(!1);
    const s=t.dataTransfer.files[0];
    s&&ie(s)
  },[ie]),$e=t=>{
    const s=t.target.files?.[0];
    s&&ie(s)
  },Me=async()=>{
    if(!c&&!a)return;
    F(!0),h(""),N(null),w(""),T(null),je.current=new AbortController;
    let t="";
    try{
      const s=await O(Ze,{
        method:"POST",headers:{
          "Content-Type":"application/json"
        },body:JSON.stringify({
          query:"开始",upload_file_id:c,file_type:o
        }),signal:je.current.signal
      });
      if(!s.ok){
        const Z=await s.json();
        throw new Error(Z.error||"服务器响应异常")
      }const m=s.body.getReader(),l=new TextDecoder;
      let P="";
      for(;
      ;
      ){
        const{
          done:Z,value:de
        }=await m.read();
        if(Z)break;
        P+=l.decode(de,{
          stream:!0
        });
        const Ne=P.split(`
`);
        P=Ne.pop()||"";
        for(const xe of Ne)if(!(!xe.trim()||!xe.startsWith("data: ")))try{
          const C=JSON.parse(xe.slice(6));
          if(C.event==="message"&&C.answer){
            if(C.answer.includes('"type":"blob_chunk"'))continue;
            t+=C.answer,h(t)
          }if(C.event==="workflow_finished"||C.event==="message_end"){
            const me=C.data?.outputs?.text||C.data?.outputs?.answer||t,D=ke(me);
            if(D.length>0)try{
              const K=await(await O("/api/material-quote/analyze",{
                method:"POST",headers:{
                  "Content-Type":"application/json"
                },body:JSON.stringify({
                  customerName:D[0].customer_name,baseCopperPrice:b,items:D.map(i=>({
                    material_no:i.material_no,material_recognize:i.material_recognize,unit_price:Number(i.unit_price),length_m:i.length_m||1e3,extracted_weight_t:i.extracted_weight_t
                  }))
                })
              })).json();
              if(K.success&&K.items)N(K.items);
              else{
                const i=D.map(d=>{
                  const he=I(d.customer_name,d.material_no,d.match_1.material_spec||d.match_1.material_match,Number(d.unit_price),b),ue=I(d.customer_name,d.material_no,d.match_2.material_spec||d.match_2.material_match,Number(d.unit_price),b),Je=I(d.customer_name,d.material_no,d.match_3.material_spec||d.match_3.material_match,Number(d.unit_price),b);
                  return{
                    ...d,match_1:{
                      ...d.match_1,...he
                    },match_2:{
                      ...d.match_2,...ue
                    },match_3:{
                      ...d.match_3,...Je
                    }
                  }
                });
                N(i)
              }
            }catch{
              const K=D.map(i=>{
                const d=I(i.customer_name,i.material_no,i.match_1.material_spec||i.match_1.material_match,Number(i.unit_price),b),he=I(i.customer_name,i.material_no,i.match_2.material_spec||i.match_2.material_match,Number(i.unit_price),b),ue=I(i.customer_name,i.material_no,i.match_3.material_spec||i.match_3.material_match,Number(i.unit_price),b);
                return{
                  ...i,match_1:{
                    ...i.match_1,...d
                  },match_2:{
                    ...i.match_2,...he
                  },match_3:{
                    ...i.match_3,...ue
                  }
                }
              });
              N(K)
            }else N(null);
            t||h(me);
            const A={
              id:c||`mq-${
                Date.now()
              }`,timestamp:new Date().toLocaleString("zh-CN",{
                month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"
              }),fileName:a?.name||"未知文件",fileUrl:E||"",fileType:o,customerName:D.length>0?D[0].customer_name:"待识别",summary:`共识别 ${
                D.length
              } 项物料`,fullContent:me
            };
            O("/api/material-quote/history",{
              method:"POST",headers:{
                "Content-Type":"application/json"
              },body:JSON.stringify({
                id:A.id,fileName:A.fileName,fileUrl:A.fileUrl,fileType:A.fileType,customerName:A.customerName,summary:A.summary,fullContent:A.fullContent
              })
            }).then(()=>ce()),window.dispatchEvent(new CustomEvent("app-task-done",{
              detail:{
                appId:"materialquote"
              }
            }))
          }
        }catch(C){
          console.warn("JSON parse error",C)
        }
      }
    }catch(s){
      s.name!=="AbortError"&&w("询价请求失败："+(s instanceof Error?s.message:String(s)))
    }finally{
      F(!1)
    }
  },Re=()=>{
    if(!n||n.length===0)return;
    const t=n[0].customer_name;
    pe(`确定一键审核并将当前 ${
      n.length
    } 项物料同步到 ERP 生成内部正式订单吗？`,async()=>{
      be(!0);
      try{
        const m=await(await O("/api/material-quote/sync-erp",{
          method:"POST",headers:{
            "Content-Type":"application/json"
          },body:JSON.stringify({
            customerName:t,copperPriceType:"现货价",copperBasePrice:b,items:n.map(l=>({
              material_no:l.material_no,qty:l.length_m||1e3,unit_price:Number(l.unit_price)
            }))
          })
        })).json();
        if(m.success&&m.orderId)T(m.orderId);
        else{
          const l=`SO-${
            new Date().toISOString().slice(0,10).replace(/-/g,"")
          }${
            Math.floor(100+Math.random()*900)
          }`;
          T(l)
        }
      }catch{
        const m=`SO-${
          new Date().toISOString().slice(0,10).replace(/-/g,"")
        }${
          Math.floor(100+Math.random()*900)
        }`;
        T(m)
      }finally{
        be(!1)
      }
    })
  },Ue=t=>{
    W(t.id),T(null);
    const s=ke(t.fullContent);
    if(s.length>0){
      const m=s.map(l=>{
        const P=I(l.customer_name,l.material_no,l.match_1.material_spec||l.match_1.material_match,Number(l.unit_price),b),Z=I(l.customer_name,l.material_no,l.match_2.material_spec||l.match_2.material_match,Number(l.unit_price),b),de=I(l.customer_name,l.material_no,l.match_3.material_spec||l.match_3.material_match,Number(l.unit_price),b);
        return{
          ...l,match_1:{
            ...l.match_1,...P
          },match_2:{
            ...l.match_2,...Z
          },match_3:{
            ...l.match_3,...de
          }
        }
      });
      N(m)
    }else N(null);
    h(t.fullContent),u(null),M(t.fileUrl),f(t.fileType),j(null),w("")
  },qe=(t,s)=>{
    s.stopPropagation(),pe("确定要删除这条历史记录吗？",async()=>{
      try{
        await O(`/api/material-quote/history/${
          t
        }`,{
          method:"DELETE"
        }),ce(),H===t&&oe()
      }catch{
        
      }
    })
  },Le=()=>{
    pe("确定要清空所有历史询价记录吗？",async()=>{
      try{
        await O("/api/material-quote/history",{
          method:"DELETE"
        }),X([]),oe()
      }catch{
        
      }
    })
  },oe=()=>{
    u(null),j(null),h(""),N(null),w(""),W(null),T(null),G.current&&(G.current.value="")
  };
  return e.jsxs("div",{
    className:"h-full w-full flex flex-col overflow-hidden text-slate-800 bg-gradient-to-br from-slate-50/50 to-white animate-in fade-in duration-500",children:[e.jsx("div",{
      className:"shrink-0 px-5 pt-4 pb-2 border-b border-slate-200/60 bg-white/80 backdrop-blur-xl",children:e.jsxs("div",{
        className:"flex items-center gap-3",children:[e.jsx("div",{
          className:"w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20 shrink-0",children:e.jsx(te,{
            className:"w-5 h-5 text-white"
          })
        }),e.jsxs("div",{
          children:[e.jsx("h1",{
            className:"text-xl font-black text-slate-900 tracking-tight",children:"物料智能报价系统 Pro"
          }),e.jsx("p",{
            className:"text-xs text-slate-400 font-medium",children:"智能识别询价单 · 联动客户账期与实物库存 · 动态剖析加工费与排产调度"
          })]
        })]
      })
    }),e.jsxs("div",{
      className:"flex flex-1 overflow-hidden gap-0",children:[e.jsxs("div",{
        className:"w-[24%] shrink-0 flex flex-col gap-5 p-6 border-r border-slate-200/60 bg-slate-50/100 overflow-y-auto",children:[e.jsxs("div",{
          className:`relative border-2 border-dashed rounded-3xl p-8 flex flex-col items-center justify-center gap-4 cursor-pointer transition-all duration-300 min-h-[200px]
                            ${
            S?"border-emerald-400 bg-emerald-50 scale-[1.02]":"border-slate-300 bg-white hover:border-emerald-300 hover:bg-emerald-50/30"
          }
                            ${
            a?"border-emerald-400 bg-emerald-50/40":""
          }`,onDragOver:t=>{
            t.preventDefault(),g(!0)
          },onDragLeave:()=>g(!1),onDrop:Ae,onClick:()=>G.current?.click(),children:[e.jsx("input",{
            ref:G,type:"file",className:"hidden",accept:"image/*,.pdf",onChange:$e
          }),y?e.jsxs(e.Fragment,{
            children:[e.jsx(V,{
              className:"w-12 h-12 text-emerald-500 animate-spin"
            }),e.jsx("p",{
              className:"text-sm font-black text-emerald-600",children:"文件上传中..."
            })]
          }):a?e.jsxs(e.Fragment,{
            children:[a.type.startsWith("image/")?e.jsx(We,{
              className:"w-12 h-12 text-emerald-500"
            }):e.jsx(Y,{
              className:"w-12 h-12 text-emerald-500"
            }),e.jsx("p",{
              className:"text-sm font-black text-emerald-700 text-center break-all leading-relaxed px-2",children:a.name
            }),c&&e.jsx("span",{
              className:"text-xs text-emerald-600 bg-emerald-100 px-3 py-1 rounded-full font-black",children:"✓ 已就绪"
            }),e.jsx("button",{
              className:"absolute top-2 right-2 w-6 h-6 rounded-full bg-white/80 flex items-center justify-center shadow hover:bg-red-50 hover:text-red-500",onClick:t=>{
                t.stopPropagation(),oe()
              },children:e.jsx(ee,{
                className:"w-3 h-3"
              })
            })]
          }):e.jsxs(e.Fragment,{
            children:[e.jsx("div",{
              className:"w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center border border-slate-200",children:e.jsx(Ge,{
                className:"w-7 h-7 text-slate-400"
              })
            }),e.jsxs("div",{
              className:"text-center",children:[e.jsx("p",{
                className:"text-sm font-bold text-slate-600",children:"点击或拖入文件"
              }),e.jsx("p",{
                className:"text-xs text-slate-400 mt-1",children:"支持图片 · PDF 格式"
              })]
            })]
          })]
        }),e.jsxs("div",{
          className:"bg-white border border-slate-200/80 rounded-2xl p-4.5 shadow-sm",children:[e.jsxs("div",{
            className:"flex items-center justify-between mb-2",children:[e.jsxs("label",{
              className:"text-xs font-black text-slate-400 uppercase tracking-wider flex items-center gap-1.5",children:[e.jsx(Ie,{
                className:"w-3.5 h-3.5 text-emerald-500"
              }),e.jsx("span",{
                children:"基准铜价核算值 (元/kg)"
              })]
            }),e.jsx("span",{
              className:"text-[10px] text-emerald-600 font-extrabold bg-emerald-50 px-1.5 py-0.5 rounded",children:"实时可调"
            })]
          }),e.jsx("input",{
            type:"number",step:"0.1",value:b,onChange:t=>ae(parseFloat(t.target.value)||0),className:"w-full bg-slate-50 border border-slate-200 focus:border-emerald-500 outline-none rounded-xl px-4 py-2.5 font-black text-slate-800 text-lg shadow-inner"
          }),e.jsx("p",{
            className:"text-[10px] text-slate-400 font-bold mt-1.5",children:"说明：输入今日基准铜价，系统将自适应重算铜重Portion与实际加工费占比。"
          })]
        }),e.jsx("button",{
          onClick:Me,disabled:!c&&!a||p||y,className:`relative overflow-hidden w-full py-4.5 rounded-2xl font-black text-base flex items-center justify-center gap-3 shadow-lg transition-all duration-300 group
                            ${
            c&&!p?"bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-600 text-white hover:scale-[1.02] shadow-emerald-500/30 active:scale-95":"bg-slate-200 text-slate-400 cursor-not-allowed shadow-none"
          }`,children:p?e.jsxs(e.Fragment,{
            children:[e.jsx(V,{
              className:"w-5 h-5 animate-spin"
            }),e.jsx("span",{
              children:"AI 分析中..."
            })]
          }):e.jsxs(e.Fragment,{
            children:[e.jsx(Se,{
              className:"w-5 h-5"
            }),e.jsx("span",{
              children:"发起询价"
            }),e.jsx(we,{
              className:"w-4 h-4 group-hover:translate-x-1"
            })]
          })
        }),(a||E)&&e.jsxs("div",{
          className:"flex-1 min-h-0 flex flex-col gap-3 animate-in fade-in slide-in-from-top-2 duration-300 pb-4",children:[e.jsxs("div",{
            className:"flex items-center justify-between px-1 shrink-0 pt-2",children:[e.jsx("span",{
              className:"text-xs font-black text-slate-400 uppercase tracking-[0.2em]",children:"文件预览"
            }),e.jsx("button",{
              className:"text-xs text-emerald-600 font-black hover:underline",onClick:()=>R(!0),children:"放大查看"
            })]
          }),e.jsxs("div",{
            className:"relative flex-1 min-h-[120px] rounded-3xl border border-slate-200 bg-white overflow-hidden shadow-md group/prev cursor-zoom-in flex items-center justify-center",onClick:()=>R(!0),children:[o==="image"?e.jsx("img",{
              src:E,alt:"preview",className:"w-full h-full object-cover transition-transform duration-700 group-hover/prev:scale-110"
            }):e.jsxs("div",{
              className:"w-full h-full flex flex-col items-center justify-center bg-slate-50/50 gap-3",children:[e.jsx("div",{
                className:"w-16 h-16 rounded-2xl bg-white flex items-center justify-center shadow-sm border border-slate-100",children:e.jsx(Y,{
                  className:"w-8 h-8 text-emerald-400"
                })
              }),e.jsx("span",{
                className:"text-xs text-slate-500 font-black",children:"PDF 文档预览就绪"
              })]
            }),e.jsx("div",{
              className:"absolute inset-0 bg-black/0 group-hover/prev:bg-black/10 transition-all flex items-center justify-center text-white opacity-0 group-hover/prev:opacity-100 backdrop-blur-[2px]",children:e.jsx("div",{
                className:"w-12 h-12 rounded-full bg-white/20 backdrop-blur-xl border border-white/30 flex items-center justify-center shadow-2xl",children:e.jsx(Qe,{
                  className:"w-6 h-6 text-white drop-shadow-xl"
                })
              })
            })]
          })]
        }),k&&e.jsxs("div",{
          className:"bg-red-50 rounded-xl p-3 border border-red-200 flex items-start gap-2",children:[e.jsx(_e,{
            className:"w-4 h-4 text-red-500 shrink-0 mt-0.5"
          }),e.jsx("p",{
            className:"text-xs text-red-600 font-medium break-words",children:k
          })]
        })]
      }),e.jsxs("div",{
        className:"flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/50",children:[ge&&e.jsxs("div",{
          className:"bg-gradient-to-r from-emerald-500 to-teal-600 text-white rounded-2xl p-5 shadow-lg shadow-emerald-500/20 flex items-center justify-between animate-in slide-in-from-top duration-500 mb-2",children:[e.jsxs("div",{
            className:"flex items-center gap-3",children:[e.jsx("div",{
              className:"w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center",children:e.jsx(Ve,{
                className:"w-6 h-6 text-white"
              })
            }),e.jsxs("div",{
              children:[e.jsx("h4",{
                className:"font-black text-sm",children:"ERP 内部订单同步成功 ✓"
              }),e.jsxs("p",{
                className:"text-xs text-emerald-100 font-medium",children:["订单号：",ge," (成品库存已自动分配并同步车间排程)"]
              })]
            })]
          }),e.jsx("button",{
            onClick:()=>T(null),className:"text-white/70 hover:text-white",children:e.jsx(ee,{
              className:"w-5 h-5"
            })
          })]
        }),!p&&!v&&!n?e.jsxs("div",{
          className:"h-full flex flex-col items-center justify-center text-center space-y-6 py-12 opacity-60",children:[e.jsx(te,{
            className:"w-24 h-24 text-slate-300"
          }),e.jsx("div",{
            children:e.jsx("p",{
              className:"text-xl font-black text-slate-400",children:"等待上传询价单文件"
            })
          })]
        }):p&&!n?e.jsxs("div",{
          className:"h-full flex flex-col items-center justify-center text-center space-y-4",children:[e.jsx(V,{
            className:"w-12 h-12 text-emerald-500 animate-spin"
          }),e.jsx("p",{
            className:"text-sm font-bold text-slate-600",children:"正在与 AI 大模型深度交互并加载 Mock 业务核算..."
          })]
        }):n?e.jsxs("div",{
          className:"space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500 pb-10",children:[e.jsxs("div",{
            className:"bg-white rounded-2xl border border-blue-200 shadow-sm overflow-hidden mb-6 flex items-center justify-between px-6 py-4",children:[e.jsxs("div",{
              className:"flex items-center gap-4",children:[e.jsx("div",{
                className:"w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center",children:e.jsx(Be,{
                  className:"w-6 h-6 text-blue-600"
                })
              }),e.jsxs("div",{
                children:[e.jsxs("div",{
                  className:"flex items-center gap-3 mb-1",children:[e.jsx("p",{
                    className:"text-xs text-slate-500 font-bold uppercase tracking-wider",children:"询价单客户"
                  }),e.jsxs("span",{
                    className:"px-2 py-0.5 bg-emerald-50 text-emerald-600 text-[10px] font-black rounded-full border border-emerald-100 shadow-sm",children:["共识别 ",n.length," 项物料"]
                  })]
                }),e.jsx("h2",{
                  className:"text-xl font-black text-slate-800 tracking-tight",children:ve(0,n[0]?.customer_name||"未知客户")
                })]
              })]
            }),e.jsxs("div",{
              className:"flex items-center gap-3",children:[e.jsx("button",{
                className:"font-bold text-sm px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-emerald-600 transition-colors",onClick:De,children:n.every((t,s)=>ne[s])?"全部收起":"全部展开"
              }),e.jsx("button",{
                className:`group relative overflow-hidden px-6 py-3 text-white rounded-2xl font-black text-sm shadow-xl transition-all duration-300 flex items-center gap-2.5
                                            ${
                  re?"bg-slate-400 cursor-not-allowed shadow-none":"bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-700 hover:scale-[1.02] shadow-blue-500/30 active:scale-95"
                }`,onClick:Re,disabled:re,children:re?e.jsxs(e.Fragment,{
                  children:[e.jsx(V,{
                    className:"w-4 h-4 animate-spin"
                  }),e.jsx("span",{
                    children:"ERP 写入中..."
                  })]
                }):e.jsxs(e.Fragment,{
                  children:[e.jsx(Y,{
                    className:"w-4 h-4 text-blue-100"
                  }),e.jsx("span",{
                    children:"一键审核并同步 ERP"
                  }),e.jsx(we,{
                    className:"w-3.5 h-3.5 text-white/50 group-hover:translate-x-0.5 transition-transform"
                  })]
                })
              })]
            })]
          }),n.map((t,s)=>e.jsx(st,{
            item:t,idx:s,isExpanded:!!ne[s],onToggle:()=>Oe(s),baseCopperPrice:b,onOpenCustomerProfile:Pe
          },s))]
        }):e.jsxs("div",{
          className:"h-full flex flex-col items-center justify-center p-8",children:[e.jsx(_e,{
            className:"w-12 h-12 text-red-400 mb-4"
          }),e.jsx("p",{
            className:"text-sm font-bold text-slate-600 mb-2",children:"解析结果失败"
          }),e.jsx("div",{
            className:"w-full max-w-2xl text-left bg-slate-800 text-slate-200 p-4 rounded-xl text-xs font-mono overflow-auto max-h-96 whitespace-pre-wrap",children:v||"无返回数据"
          })]
        })]
      }),e.jsxs("div",{
        className:"w-[20%] shrink-0 flex flex-col border-l border-slate-200/60 bg-slate-50/40 overflow-hidden",children:[e.jsxs("div",{
          className:"px-4 py-3 border-b border-slate-200/60 flex items-center justify-between shrink-0 bg-white/60 backdrop-blur",children:[e.jsxs("div",{
            className:"flex items-center gap-2",children:[e.jsx(Fe,{
              className:"w-4 h-4 text-slate-500"
            }),e.jsx("span",{
              className:"text-sm font-black text-slate-700",children:"历史询价记录"
            })]
          }),$.length>0&&e.jsx("button",{
            onClick:Le,className:"text-slate-400 hover:text-red-500 p-1 rounded-lg",children:e.jsx(ye,{
              className:"w-3.5 h-3.5"
            })
          })]
        }),e.jsx("div",{
          className:"flex-1 overflow-y-auto p-2 space-y-2 custom-scrollbar",children:$.length===0?e.jsx("div",{
            className:"flex flex-col items-center justify-center h-full text-center py-10 opacity-50",children:e.jsx("p",{
              className:"text-xs text-slate-400 font-medium",children:"暂无记录"
            })
          }):$.map(t=>e.jsxs("div",{
            onClick:()=>Ue(t),className:`group/item relative w-full text-left p-3 rounded-xl transition-all border cursor-pointer ${
              H===t.id?"bg-emerald-50 border-emerald-200":"bg-white border-slate-200 hover:bg-slate-50"
            }`,children:[e.jsxs("div",{
              className:"flex items-center gap-2 mb-1",children:[e.jsx(te,{
                className:`w-3.5 h-3.5 ${
                  H===t.id?"text-emerald-500":"text-slate-400"
                }`
              }),e.jsx("span",{
                className:"text-xs font-black truncate",children:t.customerName
              })]
            }),e.jsx("p",{
              className:"text-[10px] text-slate-400 truncate",children:t.fileName
            }),e.jsx("button",{
              onClick:s=>qe(t.id,s),className:"absolute top-2.5 right-2 p-1 text-slate-300 hover:text-red-500 opacity-0 group-hover/item:opacity-100 transition-opacity",children:e.jsx(ye,{
                className:"w-3 h-3"
              })
            })]
          },t.id))
        })]
      })]
    }),le&&_&&e.jsxs("div",{
      className:"fixed inset-0 z-50 overflow-hidden flex justify-end",children:[e.jsx("div",{
        className:"absolute inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity",onClick:()=>Q(!1)
      }),e.jsxs("div",{
        className:"relative w-full max-w-md bg-white h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-300",children:[e.jsxs("div",{
          className:"p-6 border-b border-slate-200 flex items-center justify-between shrink-0 bg-slate-50/50",children:[e.jsxs("div",{
            className:"flex items-center gap-2.5",children:[e.jsx(Ce,{
              className:"w-5 h-5 text-indigo-600"
            }),e.jsx("h3",{
              className:"font-black text-lg text-slate-800",children:"客户 360° 风控与备货画像"
            })]
          }),e.jsx("button",{
            onClick:()=>Q(!1),className:"w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center",children:e.jsx(ee,{
              className:"w-4 h-4"
            })
          })]
        }),e.jsxs("div",{
          className:"flex-1 overflow-y-auto p-6 space-y-6",children:[e.jsxs("div",{
            children:[e.jsx("h4",{
              className:"text-xs font-black text-slate-400 uppercase tracking-widest mb-3",children:"🛡️ 风控与资质审核"
            }),e.jsxs("div",{
              className:"bg-slate-50 border border-slate-100 rounded-2xl p-4 space-y-3",children:[e.jsxs("div",{
                className:"flex justify-between items-center",children:[e.jsx("span",{
                  className:"text-xs text-slate-500 font-bold",children:"客户名称"
                }),e.jsx("span",{
                  className:"text-xs font-black text-slate-800",children:ve(0,U)
                })]
              }),e.jsxs("div",{
                className:"flex justify-between items-center",children:[e.jsx("span",{
                  className:"text-xs text-slate-500 font-bold",children:"风控评级"
                }),e.jsxs("span",{
                  className:"bg-indigo-50 text-indigo-600 text-xs font-black px-2 py-0.5 rounded border border-indigo-100",children:[_.risk_level," 级"]
                })]
              }),e.jsxs("div",{
                className:"flex justify-between items-center",children:[e.jsx("span",{
                  className:"text-xs text-slate-500 font-bold",children:"账期风控状态"
                }),e.jsx("span",{
                  className:`text-xs font-black px-2 py-0.5 rounded ${
                    _.credit_status==="良好"?"bg-emerald-50 text-emerald-600 border border-emerald-100":_.credit_status==="预警"?"bg-amber-50 text-amber-600 border border-amber-100":"bg-red-50 text-red-600 border border-red-100"
                  }`,children:_.credit_status
                })]
              })]
            })]
          }),e.jsxs("div",{
            children:[e.jsx("h4",{
              className:"text-xs font-black text-slate-400 uppercase tracking-widest mb-3",children:"💰 额度与拖欠核算"
            }),e.jsxs("div",{
              className:"bg-slate-50 border border-slate-100 rounded-2xl p-4 space-y-3",children:[e.jsxs("div",{
                className:"flex justify-between items-center",children:[e.jsx("span",{
                  className:"text-xs text-slate-500 font-bold",children:"可用信用额度"
                }),e.jsxs("span",{
                  className:"text-sm font-black text-slate-800",children:["¥",_.credit_limit.toLocaleString()]
                })]
              }),e.jsxs("div",{
                className:"flex justify-between items-center",children:[e.jsx("span",{
                  className:"text-xs text-slate-500 font-bold",children:"当前未结账应收额"
                }),e.jsxs("span",{
                  className:"text-sm font-black text-slate-800",children:["¥",_.outstanding_balance.toLocaleString()]
                })]
              }),e.jsxs("div",{
                className:"flex justify-between items-center",children:[e.jsx("span",{
                  className:"text-xs text-slate-500 font-bold",children:"超期已拖欠欠款"
                }),e.jsxs("span",{
                  className:`text-sm font-black ${
                    _.overdue_amount>0?"text-red-600":"text-slate-800"
                  }`,children:["¥",_.overdue_amount.toLocaleString()]
                })]
              }),_.overdue_amount>0&&e.jsxs("div",{
                className:"bg-red-50 text-red-700 text-[10px] p-2.5 rounded-xl border border-red-100/50 flex items-start gap-1.5 mt-2",children:[e.jsx(Ye,{
                  className:"w-3.5 h-3.5 shrink-0"
                }),e.jsx("span",{
                  children:"该客户有超期拖欠未清账款，财务规定不可额外申请账期，建议以现款/锁款模式交付！"
                })]
              })]
            })]
          }),e.jsxs("div",{
            children:[e.jsx("h4",{
              className:"text-xs font-black text-slate-400 uppercase tracking-widest mb-3",children:"📦 对应匹配品实物库存"
            }),e.jsxs("div",{
              className:"bg-slate-50 border border-slate-100 rounded-2xl p-4 space-y-3",children:[e.jsxs("div",{
                className:"flex justify-between items-center",children:[e.jsx("span",{
                  className:"text-xs text-slate-500 font-bold",children:"对应成品物料"
                }),e.jsx("span",{
                  className:"text-xs font-black text-slate-800",children:L
                })]
              }),e.jsxs("div",{
                className:"flex justify-between items-center",children:[e.jsx("span",{
                  className:"text-xs text-slate-500 font-bold",children:"物料规格"
                }),e.jsx("span",{
                  className:"text-xs font-black text-slate-600",children:J
                })]
              }),e.jsxs("div",{
                className:"flex justify-between items-center",children:[e.jsx("span",{
                  className:"text-xs text-slate-500 font-bold",children:"可用现货库存"
                }),e.jsx("span",{
                  className:`text-sm font-black ${
                    _.stock_available>0?"text-emerald-600":"text-amber-600"
                  }`,children:_.stock_available>0?`${
                    _.stock_available
                  } 米 (可直接扣减发货)`:"0 米 (无现货备库，需排产生产)"
                })]
              })]
            })]
          })]
        })]
      })]
    }),se&&E&&e.jsxs("div",{
      className:"fixed inset-0 z-[600] bg-slate-900/90 backdrop-blur-md flex flex-col animate-in fade-in",onClick:()=>R(!1),children:[e.jsxs("div",{
        className:"h-16 shrink-0 flex items-center justify-between px-6 border-b border-white/10 bg-black/20",children:[e.jsxs("div",{
          className:"flex items-center gap-3",children:[e.jsx(Y,{
            className:"w-5 h-5 text-emerald-400"
          }),e.jsx("span",{
            className:"text-white font-bold text-sm",children:a?.name||"预览"
          })]
        }),e.jsx("button",{
          className:"w-10 h-10 rounded-full bg-white/10 flex items-center justify-center",onClick:()=>R(!1),children:e.jsx(ee,{
            className:"w-5 h-5 text-white"
          })
        })]
      }),e.jsx("div",{
        className:"flex-1 overflow-hidden p-8 flex items-center justify-center",onClick:t=>t.stopPropagation(),children:o==="image"?e.jsx("img",{
          src:E,alt:"zoom",className:"max-w-full max-h-full object-contain rounded-lg shadow-2xl"
        }):e.jsx("iframe",{
          src:E,className:"w-full h-full rounded-lg bg-white",title:"pdf-preview"
        })
      })]
    })]
  })
};
export{
  xt as MaterialQuoteModule
};

