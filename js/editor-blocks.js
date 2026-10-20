// A small, stable block palette. The JSON section names remain protocol-compatible.
export const STUDY_BLOCK_TYPES = Object.freeze([
  {type:'text',label:'Testo',description:'Paragrafo di spiegazione'},
  {type:'concept',label:'Concetto',description:'Definizione o idea principale'},
  {type:'example',label:'Esempio',description:'Esempio svolto'},
  {type:'formula',label:'Formula',description:'Espressione LaTeX e spiegazione'},
  {type:'image',label:'Immagine',description:'Immagine con didascalia'},
  {type:'video',label:'Video',description:'Video da un link'},
  {type:'embed',label:'PDF o link',description:'File PDF o altra risorsa'},
  {type:'callout',label:'Nota',description:'Informazione da evidenziare'},
  {type:'list',label:'Elenco',description:'Elenco puntato'},
  {type:'comparison',label:'Confronto',description:'Due concetti affiancati'},
  {type:'flow',label:'Procedimento',description:'Passaggi in sequenza'},
  {type:'checkpoint',label:'Verifica',description:'Domanda con risposta'}
]);

export function studyBlockTemplate(type, id) {
  if (!STUDY_BLOCK_TYPES.some(block=>block.type===type)) throw new Error('Tipo blocco non supportato: '+type);
  if (typeof id !== 'string' || !id) throw new Error('ID del blocco obbligatorio');
  const section={id,type};
  switch(type) {
    case 'checkpoint':return {...section,question:'Scrivi una domanda di verifica',answer:'Scrivi la risposta'};
    case 'formula':return {...section,title:'Nuova formula',latex:'',note:'Spiega il significato della formula'};
    case 'image':return {...section,title:'Immagine',mediaRef:'',url:'',alt:'',caption:''};
    case 'video':return {...section,title:'Video',url:'',caption:''};
    case 'embed':return {...section,title:'PDF o risorsa',url:'',body:''};
    case 'flow':return {...section,title:'Procedimento',nodes:['Passaggio 1','Passaggio 2'],body:''};
    case 'comparison':return {...section,title:'Confronto',left:{title:'Prima',body:''},right:{title:'Dopo',body:''}};
    case 'list':return {...section,title:'Elenco',body:'- Primo punto\n- Secondo punto'};
    default:return {...section,title:type==='example'?'Esempio':'Nuova sezione',body:'Scrivi qui il contenuto…'};
  }
}
