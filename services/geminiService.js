import { GoogleGenAI, Type } from "@google/genai";

if (!process.env.API_KEY) {
    throw new Error("Clé API manquante. Veuillez la configurer dans vos variables d'environnement.");
}

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export async function analyzeClothingImages(base64Images) {
  const textPart = {
    text: `Analyse chacune des images de vêtements fournies. Pour chaque image, dans l'ordre, extrais les informations suivantes en français :
    1. Une description concise incluant son type (ex: T-shirt, jean), sa couleur principale, et son style.
    2. Sa catégorie : "Hauts", "Bas", "Chaussures", ou "Accessoires".
    3. Sa couleur principale (ex: "Bleu", "Noir"). Sois concis.
    4. Sa matière principale (ex: "Coton", "Cuir"). Sois concis.
    
    Retourne le résultat sous la forme d'un objet JSON unique contenant une clé "items", qui est un tableau d'objets. Chaque objet du tableau doit correspondre à une image et contenir les champs : "analysis", "category", "color", et "material".`,
  };

  const imageParts = base64Images.map(img => ({
    inlineData: {
      data: img,
      mimeType: 'image/jpeg',
    },
  }));

  const response = await ai.models.generateContent({
    model: 'gemini-flash-latest',
    contents: { parts: [textPart, ...imageParts] },
    config: {
        responseMimeType: "application/json",
        responseSchema: {
            type: Type.OBJECT,
            properties: {
                items: {
                    type: Type.ARRAY,
                    description: "Un tableau d'analyses pour chaque vêtement.",
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            analysis: {
                                type: Type.STRING,
                                description: "La description concise du vêtement."
                            },
                            category: {
                                type: Type.STRING,
                                description: 'La catégorie du vêtement parmi "Hauts", "Bas", "Chaussures", ou "Accessoires".',
                                enum: ["Hauts", "Bas", "Chaussures", "Accessoires"]
                            },
                            color: {
                                type: Type.STRING,
                                description: "La couleur principale du vêtement."
                            },
                            material: {
                                type: Type.STRING,
                                description: "La matière principale du vêtement."
                            }
                        },
                        required: ["analysis", "category", "color", "material"]
                    }
                }
            },
            required: ["items"]
        }
    }
  });

  try {
      const result = JSON.parse(response.text);
      const validCategories = ["Hauts", "Bas", "Chaussures", "Accessoires"];
      
      result.items.forEach(item => {
          if (!validCategories.includes(item.category)) {
              console.warn(`Catégorie invalide reçue de l'IA: ${item.category}, fallback sur "Accessoires"`);
              item.category = "Accessoires";
          }
      });
      
      return result.items;
  } catch (e) {
      console.error("Erreur de parsing de la réponse de l'IA pour l'analyse par lot:", e);
      console.error("Réponse reçue:", response.text);
      throw new Error("L'IA a renvoyé une réponse d'analyse malformée.");
  }
}

function isClothingSet(item) {
    return item && item.name && Array.isArray(item.itemIds);
}

export async function generateOutfits(
    clothingList,
    sets,
    context,
    anchorItemOrSet
) {
    const itemIdsInSets = new Set(sets.flatMap(s => s.itemIds));
    const individualItems = clothingList.filter(item => !itemIdsInSets.has(item.id));

    const individualItemsFormatted = individualItems.map(item => `- ${item.analysis} (Catégorie: ${item.category}, Couleur: ${item.color}, Matière: ${item.material})`).join('\n');
    const setsFormatted = sets.map(set => `- ${set.name} (Ensemble)`).join('\n');

    const availableClothes = [individualItemsFormatted, setsFormatted].filter(Boolean).join('\n');

    const anchorInstruction = anchorItemOrSet
        ? `\n**RÈGLE CRITIQUE : Chaque tenue DOIT impérativement inclure l'article ou l'ensemble suivant : "${isClothingSet(anchorItemOrSet) ? anchorItemOrSet.name : anchorItemOrSet.analysis}". C'est la pièce maîtresse.**\n`
        : '';

    const prompt = `
    Tu es un styliste de mode expert. Ta mission est de créer des tenues pour un utilisateur en fonction de sa garde-robe et d'un contexte précis.

    Contexte de l'utilisateur : "${context}"
    
    RÈGLE IMPORTANTE : Les articles marqués comme "(Ensemble)" sont des groupes de vêtements inséparables. Si tu utilises un ensemble, tu dois le lister par son nom (ex: "Costume bleu marine") et ne pas lister ses composants individuels.

    Vêtements et Ensembles disponibles :
    ${availableClothes}
    ${anchorInstruction}
    En te basant **uniquement** sur les vêtements et ensembles listés ci-dessus, crée 3 tenues distinctes et cohérentes qui correspondent au contexte de l'utilisateur.

    Pour chaque tenue, fournis :
    1. Un nom de titre court et accrocheur pour la tenue.
    2. Une brève description de l'ambiance ou du style de la tenue.
    3. La liste exacte des descriptions des vêtements ou des noms d'ensembles de la liste fournie à utiliser.

    Réponds en français.
  `;

    const response = await ai.models.generateContent({
        model: "gemini-2.5-pro",
        contents: prompt,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    tenues: {
                        type: Type.ARRAY,
                        description: "La liste des suggestions de tenues.",
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                titre: { type: Type.STRING, description: "Le nom de la tenue." },
                                description: { type: Type.STRING, description: "Une brève description du style de la tenue." },
                                vetements: {
                                    type: Type.ARRAY,
                                    items: { type: Type.STRING, description: "Description d'un vêtement ou nom d'un ensemble de la liste fournie." },
                                    description: "La liste des descriptions des vêtements ou ensembles composant la tenue.",
                                }
                            },
                            required: ["titre", "description", "vetements"],
                        }
                    }
                },
                required: ["tenues"],
            }
        }
    });

    try {
        const jsonResponse = JSON.parse(response.text);
        return jsonResponse.tenues;
    } catch (e) {
        console.error("Erreur de parsing JSON de la réponse Gemini:", e);
        console.error("Réponse reçue:", response.text);
        throw new Error("L'IA a renvoyé une réponse malformée.");
    }
}


export async function generateVacationPlan(
    clothingList,
    sets,
    days,
    context,
) {
    const itemIdsInSets = new Set(sets.flatMap(s => s.itemIds));
    const individualItems = clothingList.filter(item => !itemIdsInSets.has(item.id));

    const individualItemsFormatted = individualItems.map(item => `- ${item.analysis} (Catégorie: ${item.category}, Couleur: ${item.color}, Matière: ${item.material})`).join('\n');
    const setsFormatted = sets.map(set => `- ${set.name} (Ensemble)`).join('\n');

    const availableClothes = [individualItemsFormatted, setsFormatted].filter(Boolean).join('\n');

    const prompt = `
    Tu es un styliste de voyage et un expert en organisation. Ta mission est de créer une valise optimisée pour un voyage.

    Détails du voyage :
    - Durée : ${days} jour(s)
    - Contexte / Météo : "${context}"

    Vêtements et Ensembles disponibles dans la garde-robe :
    ${availableClothes}
    
    RÈGLES :
    1. Crée une liste de vêtements à emporter qui soit polyvalente et minimale. Les articles doivent pouvoir être combinés pour créer plusieurs tenues différentes.
    2. Ne sélectionne QUE des articles de la liste fournie.
    3. Les articles marqués comme "(Ensemble)" sont inséparables. Si tu utilises un ensemble, liste-le par son nom (ex: "Costume bleu marine").
    4. Assure-toi que la quantité de vêtements est appropriée pour la durée du voyage de ${days} jour(s). Pense à la réutilisation des pièces (comme les pantalons ou les vestes).

    Fournis le résultat en français sous la forme suivante :
    1. Un "titre" accrocheur pour le plan de valise.
    2. Un "resume" court qui explique la stratégie de la valise (ex: "Une sélection capsule pour un weekend ensoleillé...").
    3. Une "valise" qui est une liste des descriptions exactes des vêtements ou des noms d'ensembles de la liste fournie à emporter.
    `;

    const response = await ai.models.generateContent({
        model: "gemini-2.5-pro",
        contents: prompt,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    titre: { type: Type.STRING, description: "Le nom du plan de valise." },
                    resume: { type: Type.STRING, description: "Un bref résumé de la stratégie de la valise." },
                    valise: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING, description: "Description d'un vêtement ou nom d'un ensemble de la liste fournie." },
                        description: "La liste des descriptions des vêtements ou ensembles à emporter.",
                    }
                },
                required: ["titre", "resume", "valise"],
            }
        }
    });

    try {
        const jsonResponse = JSON.parse(response.text);
        return jsonResponse;
    } catch (e) {
        console.error("Erreur de parsing JSON de la réponse Gemini pour la valise:", e);
        console.error("Réponse reçue:", response.text);
        throw new Error("L'IA a renvoyé une réponse malformée pour le plan de valise.");
    }
}