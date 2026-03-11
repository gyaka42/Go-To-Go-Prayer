import { DuaDetailContent, NamazSection } from "@/types/namaz";

const PRAYER_SURAH_IDS = [
  { id: "fatiha", surahId: 1 },
  { id: "fil", surahId: 105 },
  { id: "kureys", surahId: 106 },
  { id: "maun", surahId: 107 },
  { id: "kevser", surahId: 108 },
  { id: "kafirun", surahId: 109 },
  { id: "nasr", surahId: 110 },
  { id: "tebbet", surahId: 111 },
  { id: "ihlas", surahId: 112 },
  { id: "felak", surahId: 113 },
  { id: "nas", surahId: 114 }
] as const;

const NAMAZ_DUA_IDS = [
  "subhaneke",
  "ettehiyyatu",
  "allahumme_salli",
  "allahumme_barik",
  "rabbena_atina",
  "rabbenaghfirli",
  "kunut_1",
  "kunut_2"
] as const;

const ASIR_ITEMS = [
  { id: "ayetel_kursi", surahId: 2, fromAyah: 255, toAyah: 255 },
  { id: "huvallahullezi", surahId: 59, fromAyah: 22, toAyah: 24 },
  { id: "amenerresulu", surahId: 2, fromAyah: 285, toAyah: 286 }
] as const;

export const namazSections: NamazSection[] = [
  {
    id: "surahs",
    titleKey: "namaz.section_surahs",
    items: PRAYER_SURAH_IDS.map((item) => ({
      id: item.id,
      kind: "surah" as const,
      titleKey: `namaz.surah.${item.id}`,
      surahId: item.surahId
    }))
  },
  {
    id: "duas",
    titleKey: "namaz.section_duas",
    items: NAMAZ_DUA_IDS.map((id) => ({
      id,
      kind: "dua" as const,
      titleKey: `namaz.dua.${id}`
    }))
  },
  {
    id: "asirs",
    titleKey: "namaz.section_asirs",
    items: ASIR_ITEMS.map((item) => ({
      id: item.id,
      kind: "asir" as const,
      titleKey: `namaz.asir.${item.id}`,
      surahId: item.surahId,
      fromAyah: item.fromAyah,
      toAyah: item.toAyah
    }))
  }
];

export function getAsirItem(asirId: string) {
  const section = namazSections.find((value) => value.id === "asirs");
  if (!section) {
    return null;
  }
  const hit = section.items.find((item) => item.kind === "asir" && item.id === asirId);
  return hit && hit.kind === "asir" ? hit : null;
}

export const duaDetails: Record<string, DuaDetailContent> = {
  subhaneke: {
    id: "subhaneke",
    titleKey: "namaz.dua.subhaneke",
    arabic:
      "سُبْحَانَكَ اللّٰهُمَّ وَبِحَمْدِكَ وَتَبَارَكَ اسْمُكَ وَتَعَالٰى جَدُّكَ وَلَا اِلٰهَ غَيْرُكَ",
    transliteration:
      "Subhanekallahumme ve bihamdik ve tebarakesmuk ve teala cedduk ve la ilahe gayruk.",
    meaningTr:
      "Allah'ım! Sen eksikliklerden uzaksın, hamd sanadır. Adın mübarektir, şanın yücedir. Senden başka ilah yoktur.",
    meaningEn:
      "O Allah, You are free from all imperfection, and praise is Yours. Blessed is Your name, exalted is Your majesty, and there is no god besides You.",
    meaningNl:
      "O Allah, U bent vrij van alle tekortkomingen en alle lof behoort U toe. Uw naam is gezegend, Uw majesteit is verheven en er is geen god naast U."
  },
  ettehiyyatu: {
    id: "ettehiyyatu",
    titleKey: "namaz.dua.ettehiyyatu",
    arabic:
      "اَلتَّحِيَّاتُ لِلّٰهِ وَالصَّلَوَاتُ وَالطَّيِّبَاتُ، اَلسَّلَامُ عَلَيْكَ اَيُّهَا النَّبِيُّ وَرَحْمَةُ اللّٰهِ وَبَرَكَاتُهُ، اَلسَّلَامُ عَلَيْنَا وَعَلٰى عِبَادِ اللّٰهِ الصَّالِحِينَ، اَشْهَدُ اَنْ لَا اِلٰهَ اِلَّا اللّٰهُ وَاَشْهَدُ اَنَّ مُحَمَّدًا عَبْدُهُ وَرَسُولُهُ",
    transliteration:
      "Ettehiyyatu lillahi vessalavatu vettayyibat. Esselamu aleyke eyyuhennebiyyu ve rahmetullahi ve berekatuh. Esselamu aleyna ve ala ibadillahissalihin. Eşhedü en la ilahe illallah ve eşhedü enne Muhammeden abduhu ve rasuluh.",
    meaningTr:
      "Bütün hürmetler, dualar ve güzel sözler Allah'a mahsustur. Ey Nebi! Allah'ın selamı, rahmeti ve bereketi senin üzerine olsun. Selam bize ve Allah'ın salih kullarına olsun. Şahitlik ederim ki Allah'tan başka ilah yoktur ve yine şahitlik ederim ki Muhammed O'nun kulu ve resulüdür.",
    meaningEn:
      "All reverence, prayers and pure words are for Allah. Peace be upon you, O Prophet, and Allah's mercy and blessings. Peace be upon us and upon the righteous servants of Allah. I bear witness there is no god but Allah, and I bear witness that Muhammad is His servant and messenger.",
    meaningNl:
      "Alle eerbetuigingen, gebeden en goede woorden behoren aan Allah toe. Vrede zij met u, o Profeet, en Allah's barmhartigheid en zegeningen. Vrede zij met ons en met de rechtvaardige dienaren van Allah. Ik getuig dat er geen god is behalve Allah en dat Mohammed Zijn dienaar en boodschapper is."
  },
  allahumme_salli: {
    id: "allahumme_salli",
    titleKey: "namaz.dua.allahumme_salli",
    arabic:
      "اَللّٰهُمَّ صَلِّ عَلٰى مُحَمَّدٍ وَعَلٰى اٰلِ مُحَمَّدٍ كَمَا صَلَّيْتَ عَلٰى اِبْرٰهٖيمَ وَعَلٰى اٰلِ اِبْرٰهٖيمَ اِنَّكَ حَمٖيدٌ مَجٖيدٌ",
    transliteration:
      "Allahumme salli ala Muhammedin ve ala ali Muhammed, kema salleyte ala İbrahime ve ala ali İbrahim, inneke hamidun mecid.",
    meaningTr:
      "Allah'ım! İbrahim'e ve ailesine salat ettiğin gibi Muhammed'e ve ailesine de salat et. Şüphesiz sen hamde layık ve yücesin.",
    meaningEn:
      "O Allah, send Your blessings upon Muhammad and the family of Muhammad as You sent blessings upon Ibrahim and the family of Ibrahim. Indeed, You are Praiseworthy and Glorious.",
    meaningNl:
      "O Allah, schenk zegeningen aan Mohammed en de familie van Mohammed, zoals U zegeningen schonk aan Ibrahim en de familie van Ibrahim. U bent waarlijk Prijzenswaardig en Verheven."
  },
  allahumme_barik: {
    id: "allahumme_barik",
    titleKey: "namaz.dua.allahumme_barik",
    arabic:
      "اَللّٰهُمَّ بَارِكْ عَلٰى مُحَمَّدٍ وَعَلٰى اٰلِ مُحَمَّدٍ كَمَا بَارَكْتَ عَلٰى اِبْرٰهٖيمَ وَعَلٰى اٰلِ اِبْرٰهٖيمَ اِنَّكَ حَمٖيدٌ مَجٖيدٌ",
    transliteration:
      "Allahumme barik ala Muhammedin ve ala ali Muhammed, kema barekte ala İbrahime ve ala ali İbrahim, inneke hamidun mecid.",
    meaningTr:
      "Allah'ım! İbrahim'e ve ailesine bereket verdiğin gibi Muhammed'e ve ailesine de bereket ver. Şüphesiz sen hamde layık ve yücesin.",
    meaningEn:
      "O Allah, grant blessings upon Muhammad and the family of Muhammad as You granted blessings upon Ibrahim and the family of Ibrahim. Indeed, You are Praiseworthy and Glorious.",
    meaningNl:
      "O Allah, geef zegen en overvloed aan Mohammed en de familie van Mohammed, zoals U zegen gaf aan Ibrahim en de familie van Ibrahim. U bent waarlijk Prijzenswaardig en Verheven."
  },
  rabbena_atina: {
    id: "rabbena_atina",
    titleKey: "namaz.dua.rabbena_atina",
    arabic: "رَبَّنَا اٰتِنَا فِي الدُّنْيَا حَسَنَةً وَفِي الْاٰخِرَةِ حَسَنَةً وَقِنَا عَذَابَ النَّارِ",
    transliteration: "Rabbena atina fid-dunya haseneten ve fil-ahireti haseneten ve kına azaben-nar.",
    meaningTr:
      "Rabbimiz! Bize dünyada da iyilik ver, ahirette de iyilik ver ve bizi ateş azabından koru.",
    meaningEn:
      "Our Lord, grant us good in this world and good in the Hereafter, and protect us from the punishment of the Fire.",
    meaningNl:
      "Onze Heer, geef ons het goede in deze wereld en het goede in het Hiernamaals, en bescherm ons tegen de bestraffing van het Vuur."
  },
  rabbenaghfirli: {
    id: "rabbenaghfirli",
    titleKey: "namaz.dua.rabbenaghfirli",
    arabic: "رَبِّ اغْفِرْ لِي وَلِوَالِدَيَّ وَلِلْمُؤْمِنِينَ يَوْمَ يَقُومُ الْحِسَابُ",
    transliteration: "Rabbigfir li ve li valideyye ve lil mu'minine yevme yekumul hisab.",
    meaningTr:
      "Rabbim! Hesap gününde beni, annemi-babamı ve bütün müminleri bağışla.",
    meaningEn:
      "My Lord, forgive me, my parents, and all believers on the Day the account is established.",
    meaningNl:
      "Mijn Heer, vergeef mij, mijn ouders en alle gelovigen op de Dag waarop de afrekening plaatsvindt."
  },
  kunut_1: {
    id: "kunut_1",
    titleKey: "namaz.dua.kunut_1",
    arabic:
      "اَللّٰهُمَّ اِنَّا نَسْتَعِينُكَ وَنَسْتَغْفِرُكَ وَنَسْتَهْدِيكَ وَنُؤْمِنُ بِكَ وَنَتُوبُ اِلَيْكَ وَنَتَوَكَّلُ عَلَيْكَ وَنُثْنٖي عَلَيْكَ الْخَيْرَ كُلَّهُ نَشْكُرُكَ وَلَا نَكْفُرُكَ وَنَخْلَعُ وَنَتْرُكُ مَنْ يَفْجُرُكَ",
    transliteration:
      "Allahumme inna nesteinuke ve nestagfiruke ve nestehdike ve nu'minu bike ve netubu ileyk ve netevekkelü aleyk ve nüsni aleykel hayra külleh, neşküruke ve la nekfüruk ve nahle'u ve netruku men yefcuruk.",
    meaningTr:
      "Allah'ım! Senden yardım isteriz, senden bağışlanma dileriz, senden hidayet isteriz. Sana iman eder, sana tevbe eder, sana dayanırız. Bütün hayırla seni överiz. Sana şükreder, nankörlük etmeyiz. Sana isyan edeni terk ederiz.",
    meaningEn:
      "O Allah, we seek Your help, Your forgiveness and Your guidance. We believe in You, repent to You and rely on You. We praise You for all good. We thank You and do not deny You, and we leave those who rebel against You.",
    meaningNl:
      "O Allah, wij vragen Uw hulp, Uw vergeving en Uw leiding. Wij geloven in U, keren berouwvol naar U terug en vertrouwen op U. Wij prijzen U voor al het goede. Wij danken U en zijn niet ondankbaar, en wij keren ons af van wie tegen U opstandig is."
  },
  kunut_2: {
    id: "kunut_2",
    titleKey: "namaz.dua.kunut_2",
    arabic:
      "اَللّٰهُمَّ اِيَّاكَ نَعْبُدُ وَلَكَ نُصَلّٖي وَنَسْجُدُ وَاِلَيْكَ نَسْعٰى وَنَحْفِدُ نَرْجُوا رَحْمَتَكَ وَنَخْشٰى عَذَابَكَ اِنَّ عَذَابَكَ بِالْكُفَّارِ مُلْحِقٌ",
    transliteration:
      "Allahumme iyyake na'budu ve leke nusalli ve nescüd ve ileyke nes'a ve nahfid, nercu rahmeteke ve nahşa azabek, inne azabeke bil küffari mülhık.",
    meaningTr:
      "Allah'ım! Yalnız sana kulluk eder, yalnız senin için namaz kılar ve secde ederiz. Sana koşar ve yalnız seni razı etmeye çalışırız. Rahmetini umar, azabından korkarız. Şüphesiz azabın kafirlere ulaşacaktır.",
    meaningEn:
      "O Allah, You alone we worship; for You we pray and prostrate. To You we strive and hasten in service. We hope for Your mercy and fear Your punishment. Surely Your punishment reaches the disbelievers.",
    meaningNl:
      "O Allah, U alleen aanbidden wij; voor U bidden en knielen wij neer. Naar U streven wij en voor Uw tevredenheid zetten wij ons in. Wij hopen op Uw barmhartigheid en vrezen Uw bestraffing. Uw bestraffing treft zeker de ongelovigen."
  }
};

export function getDuaDetail(duaId: string): DuaDetailContent | null {
  return duaDetails[duaId] || null;
}
