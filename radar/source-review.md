# Revisão de fontes — PD-004.1

Verificação em 25/11/2026. Os resultados abaixo são observações dessa verificação, não garantia futura. Somente metadados de feeds públicos são usados como sinais privados. Nenhum texto integral ou imagem foi republicado. As três ativações usam o adaptador RSS existente, sem alterar limites de rede/XML ou adicionar dependências.

| Organização | Endpoint efetivamente consultado | HTTP / formato | Decisão e fundamento |
| --- | --- | --- | --- |
| Rockstar Games | https://www.rockstargames.com/newswire/rss | 500; formato não confirmado | Rejeitado. Caminho candidato sem feed funcional confirmado; não houve contorno ou coleta HTML. Condições não consideradas autorização. |
| Valve / Steam | https://store.steampowered.com/feeds/news/app/593110/ | 200; RSS, 10 itens | Não ativado. [Acordo Steam](https://store.steampowered.com/subscriber_agreement/), seção de automação, exige cautela; não foi obtida permissão específica que resolva a restrição geral. Existência de RSS não foi tratada como autorização comercial irrestrita. |
| PlayStation | https://blog.playstation.com/feed/ | 200; RSS, 10 itens | Rejeitado. [Termos do site](https://www.playstation.com/en-us/legal/website-terms-of-use/) restringem uso comercial e monitoramento/mineração automatizados. |
| Nintendo | https://www.nintendo.com/us/whatsnew/feed/ | 404; formato não confirmado | Rejeitado tecnicamente. Sem inferir autorização ou recorrer a scraping. |
| OpenAI | https://openai.com/news/rss.xml | 200; RSS acima de 100 itens | Não ativado. Limite de itens preservado; nenhum parâmetro de paginação inventado. [Termos consultados](https://openai.com/policies/terms-of-use/); licença de republicação não presumida. |
| Anthropic | https://www.anthropic.com/news/rss.xml | 404; formato não confirmado | Não ativado. [Página oficial](https://www.anthropic.com/news) em HTML, sem RSS adequado comprovado. Não se construiu feed por scraping nem se presumiu autorização. |
| Hugging Face | https://huggingface.co/blog/feed.xml | 200; RSS acima de 100 itens | Não ativado por limite técnico, sem ampliá-lo. [Condições consultadas](https://huggingface.co/terms-of-service); permissões individuais não inferidas. |
| Google DeepMind | https://deepmind.google/blog/rss.xml | Timeout na coleta segura local | Não ativado; falha registrada sem evasão. Ser do mesmo grupo não substitui disponibilidade e verificação. |
| Godot Engine | https://godotengine.org/rss.xml | 200; RSS, 15 itens | **Ativado**, games. [Blog oficial](https://godotengine.org/blog/), [repositório do site](https://github.com/godotengine/godot-website) e [licença do repositório](https://github.com/godotengine/godot-website/blob/master/LICENSE.txt). A licença do código do site não foi estendida a todas as imagens ou conteúdos editoriais. Apenas títulos/referências privados; sem republicação. |
| Google AI | https://blog.google/innovation-and-ai/technology/ai/rss/ | 200; RSS, 20 itens | **Ativado**, IA. [Seção oficial](https://blog.google/innovation-and-ai/technology/ai/), [termos Google](https://policies.google.com/terms), robots.txt sem bloqueio do caminho. Sem republicação de textos. |
| Google Research | https://research.google/blog/rss/ | 200; RSS, 100 itens | **Ativado**, IA/pesquisa. [Blog oficial](https://research.google/blog/), termos Google, robots.txt com Allow: /. Não certifica conclusões científicas ou independência das fontes Google. |
| Ollama | https://ollama.com/blog/rss.xml | XML reconhecido pela ferramenta de consulta; não coletado pelo radar | Não ativado. [Termos](https://ollama.com/terms) condicionam acesso automatizado à permissão; não houve esclarecimento específico. |

Microsoft Blog e Xbox Wire continuam inativos; não houve esclarecimento que autorizasse reativação.

As fontes Google têm a mesma organização e não somam peso como evidência independente. Feeds globais em inglês usam US como escopo configurado de monitoramento internacional, não como país comprovado do acontecimento ou volume regional de busca. Apenas Trends fornece recorte geo de pesquisa. O robots.txt Godot consultado não trouxe bloqueio do RSS; isso não constitui licença geral para uso futuro em IA. Pesquisa/redação por IA deverá reavaliar condições e direitos antes de consumir conteúdo integral.
