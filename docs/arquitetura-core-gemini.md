# Separação de responsabilidades — HydraSmart

O Core mantém o cálculo determinístico, processamento numérico, classificação de risco e regras de alertas. A integração Gemini atua somente na interpretação dos históricos e resultados do Core, fornecendo análises e recomendações para avaliação humana.

A chave de acesso ao Gemini deve permanecer exclusivamente no backend; o frontend acessa a funcionalidade por uma rota da API. Nenhuma resposta de IA substitui medições ou decisões determinísticas do Core.
