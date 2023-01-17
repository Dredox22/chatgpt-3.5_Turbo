import { readContext } from "./io.js";
import LanguageDetect from "languagedetect";

const lngDetector = new LanguageDetect();
let context = readContext();
for (let c in context) {
    console.log(lngDetector.detect(context[c], 1)[0]?.[0]);
}
