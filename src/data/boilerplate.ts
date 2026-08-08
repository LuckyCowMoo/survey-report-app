/**
 * Fixed report scaffolding text taken from the firm's template document.
 * Placeholders use {{key}} syntax and are filled from the report metadata.
 */

export const CONTENTS_SECTIONS = [
  {
    title: "Introduction",
    blurb:
      "An overview of the purpose and scope of the survey, detailing the objectives of the assessment and outlining the methodology employed during the inspection. This section will also include background information on the property and the specific concerns raised."
  },
  {
    title: "Inspection Details",
    blurb:
      "A comprehensive account of the inspection process, including the date of the survey, the conditions under which it was conducted, and the specific areas and elements of the property that were examined. This section will highlight any tools or techniques used to assess moisture levels and timber condition."
  },
  {
    title: "Observations and Findings",
    blurb:
      "A detailed analysis of the findings from the inspection, covering areas of moisture damage, signs of dampness, and the condition of timber structures. This section will categorise issues identified and provide insights into underlying causes, supported by photographs and measurements where applicable."
  },
  {
    title: "Recommendations & Remedial Works",
    blurb:
      "An actionable set of recommendations to address the identified issues, including suggested remedial works required to rectify the conditions observed. This may involve repair strategies, improvements to ventilation, and moisture control measures to prevent further damage."
  },
  {
    title: "Estimates/Costs",
    blurb:
      "A preliminary assessment of costs associated with the recommended remedial actions, providing a breakdown of estimates for repair work and any necessary materials or services. This section aims to facilitate budget planning for the property owner."
  },
  {
    title: "Limitations",
    blurb:
      "A disclosure of any limitations encountered during the inspection, including access restrictions, areas that were not examined in detail, or factors that may have influenced the findings. This section emphasizes the importance of ongoing monitoring and further assessments as necessary."
  }
];

export const INTRO_BLOCKS = {
  clientRequest:
    "{{company_name}} was engaged to conduct an assessment at the specific request of the property owner or designated representative, emphasising their concern regarding potential moisture-related issues. {{client_name}}",
  objective:
    "The primary purpose of the visit was to conduct a thorough inspection to identify any existing moisture or dampness issues, as well as ventilation problems that might contribute to these conditions. The goal was to formulate actionable recommendations aimed at rectifying the identified issues to ensure the property's structural integrity and comfort for its occupants.",
  propertyDescription:
    "The property under review is characterised as a {{property_type}} situated within a residential street. This positioning may influence factors such as ventilation, exposure to weather elements, and neighbouring properties' impact on the subject home.",
  reportOverview:
    "The forthcoming document provides a comprehensive report detailing the moisture damage observed during the inspection. This includes a description of affected areas, severity of damage, and potential causes contributing to the damp conditions discovered.",
  weather:
    "The assessment was conducted under {{weather_desc}} with a temperature of {{temperature}} degrees Celsius and {{sky_desc}}. These weather conditions are relevant as they may affect moisture readings and the identification of damp problems & observations in the property."
};

export const SERVICES_INTRO =
  "{{company_name}} offers a comprehensive range of services, including damp-proofing, waterproofing, timber treatments, insulation installation, and general building repairs, all performed with high-quality materials and skilled craftsmanship to ensure the long-term integrity and comfort of your property – See costs below:";

export const SERVICES_FULL =
  "Our services encompass a comprehensive range of building solutions, including eco rendering, external wall insulation (EWI), polymer and silicone rendering, sand and cement render, as well as lime rendering. We also offer roof repairs and the installation of new roofs. Our expertise extends to various building works, such as knock-throughs and extensions, alongside the installation of support beams and stainless-steel beams. Additionally, we manage the removal of chimneys, whether they are isolated, shared, or standalone. We handle most aspects of carpentry, whether roof-based or ground-based, ensuring high-quality craftsmanship and durability across all projects. Our capabilities also cover a wide array of building services, making us your go-to solution for any construction needs.";

export const COST_FOOTNOTES = {
  vatNote: "All the above prices are VAT exclusive.",
  skirtingNote:
    "It is important to note that new skirting boards will need to be fitted after the damp-proofing process is completed, and decorating will also be necessary. Furthermore, radiators must be removed before the work begins and reinstalled upon completion. Additionally, if full height wall boarding/treatment is required, the existing ceiling coving will need to be replaced after the installation is finished to ensure a seamless and polished appearance throughout the property.",
  financeNote: "We now offer finance - Just ask for details!",
  contactNote:
    "Please feel free to contact me should you require any further information on the above report."
};

export const PROJECT_PLAN_HEADING =
  "Detailed Project Plan for Remediation of damp and Associated works";

export const LIMITATIONS_TITLE =
  "Limitations of the Non-Invasive Damp and Timber Survey";

/** Fill {{key}} placeholders in a template string. */
export function fillPlaceholders(
  template: string,
  values: Record<string, string>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (whole, key: string) =>
    key in values && values[key] !== "" ? values[key] : whole
  );
}
