---
updatedAt: 2026-10-22T19:49:01.000Z
agentTools:
  projectIndex: https://doc.focusnfe.com.br/llms.txt
---

# Consultar

Consulta o status de uma NFC-e emitida.
Retorna informações sobre o processamento da nota, incluindo status de autorização, caminhos para download do XML e DANFCe, QR Code e dados de eventos.


# OpenAPI definition

```json
{
  "openapi": "3.0.3",
  "info": {
    "title": "NFCe",
    "version": "2.0.0",
    "contact": {
      "name": "Focus NFe Suporte",
      "email": "suporte@focusnfe.com.br"
    },
    "license": {
      "name": "Proprietary",
      "url": "https://focusnfe.com.br"
    }
  },
  "servers": [
    {
      "url": "https://api.focusnfe.com.br/v2",
      "description": "Servidor de Produção"
    },
    {
      "url": "https://homologacao.focusnfe.com.br/v2",
      "description": "Servidor de Homologação"
    }
  ],
  "security": [
    {
      "BasicAuth": []
    }
  ],
  "tags": [
    {
      "name": "NFCe",
      "description": "Operações relacionadas a Notas Fiscais de Consumidor Eletrônicas (NFC-e)"
    }
  ],
  "paths": {
    "/nfce/{referencia}": {
      "get": {
        "tags": [
          "NFCe"
        ],
        "summary": "Consultar",
        "description": "Consulta o status de uma NFC-e emitida.\nRetorna informações sobre o processamento da nota, incluindo status de autorização, caminhos para download do XML e DANFCe, QR Code e dados de eventos.\n",
        "operationId": "consultar_nfce",
        "parameters": [
          {
            "name": "referencia",
            "in": "path",
            "required": true,
            "description": "Referência da NFC-e",
            "schema": {
              "type": "string",
              "example": "12345"
            }
          },
          {
            "name": "completa",
            "in": "query",
            "required": false,
            "description": "Se 1, retorna dados completos da requisição e protocolo",
            "schema": {
              "type": "integer",
              "enum": [
                0,
                1
              ],
              "example": 1
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Requisição processada com sucesso",
            "content": {
              "application/json": {
                "schema": {
                  "oneOf": [
                    {
                      "$ref": "#/components/schemas/NFCeConsultaResponse"
                    },
                    {
                      "$ref": "#/components/schemas/CanceladaResponse"
                    },
                    {
                      "$ref": "#/components/schemas/ErroAutorizacaoResponse"
                    }
                  ]
                },
                "examples": {
                  "Processando autorização": {
                    "value": {
                      "cnpj_emitente": "12345678000123",
                      "ref": "ref_123456",
                      "status": "processando_autorizacao"
                    }
                  },
                  "Autorizada": {
                    "$ref": "#/components/examples/NFCeAutorizada"
                  },
                  "Autorizada completa": {
                    "$ref": "#/components/examples/NFCeAutorizadaCompleta"
                  },
                  "Cancelada": {
                    "$ref": "#/components/examples/CanceladaResponse"
                  },
                  "Erro autorização": {
                    "$ref": "#/components/examples/ErroAutorizacaoResponse"
                  }
                }
              }
            }
          },
          "401": {
            "$ref": "#/components/responses/AccessDenied"
          },
          "403": {
            "$ref": "#/components/responses/PermissaoNegada"
          },
          "404": {
            "$ref": "#/components/responses/NotFound"
          }
        }
      }
    }
  },
  "components": {
    "securitySchemes": {
      "BasicAuth": {
        "type": "http",
        "scheme": "basic",
        "description": "Autenticação com usuário e senha (HTTP Basic). O usuário é o token da API e a senha deve ser deixada em branco."
      }
    },
    "responses": {
      "AccessDenied": {
        "description": "Não autorizado",
        "content": {
          "text/html": {
            "schema": {
              "type": "string",
              "example": "HTTP Basic: Access denied"
            }
          }
        }
      },
      "NotFound": {
        "description": "Recurso não encontrado",
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/ErrorResponse"
            },
            "example": {
              "codigo": "nfce_nao_encontrada",
              "mensagem": "NFC-e não encontrada."
            }
          }
        }
      },
      "PermissaoNegada": {
        "description": "Ação não permitida",
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/ErrorResponse"
            },
            "example": {
              "codigo": "permissao_negada",
              "mensagem": "CNPJ do emitente não autorizado."
            }
          }
        }
      }
    },
    "examples": {
      "NFCeAutorizada": {
        "value": {
          "cnpj_emitente": "12345678000123",
          "ref": "referencia_000899",
          "status": "autorizado",
          "status_sefaz": "100",
          "mensagem_sefaz": "Autorizado o uso da NF-e",
          "chave_nfe": "NFe41190612345678000123650010000000121743484310",
          "numero": "12",
          "serie": "1",
          "caminho_xml_nota_fiscal": "/arquivos_development/12345678000123/201906/XMLs/41190612345678000123650010000000121743484310-nfe.xml",
          "caminho_danfe": "/notas_fiscais_consumidor/NFe41190612345678000123650010000000121743484310.html",
          "qrcode_url": "http://www.fazenda.pr.gov.br/nfce/qrcode/?p=41190612345678000123650010000000121743484310|2|2|1|5E264C0E28D801197219894CDFCF2FCCC5237F08",
          "url_consulta_nf": "http://www.fazenda.pr.gov.br/nfce/consulta"
        }
      },
      "NFCeAutorizadaCompleta": {
        "value": {
          "cnpj_emitente": "12345678000123",
          "ref": "nfce_ref_ficticia_a1b2c3",
          "status": "autorizado",
          "status_sefaz": "100",
          "mensagem_sefaz": "Autorizado o uso da NF-e",
          "chave_nfe": "NFe32260312345678000123650010000184781586515230",
          "numero": "18478",
          "serie": "1",
          "protocolo": "232260176682690",
          "caminho_xml_nota_fiscal": "/arquivos/12345678000123_185558/202603/XMLs/32260312345678000123650010000184781586515230-nfe.xml",
          "caminho_danfe": "/notas_fiscais_consumidor/NFe32260312345678000123650010000184781586515230.html",
          "qrcode_url": "http://app.sefaz.es.gov.br/ConsultaNFCe/qrcode.aspx?p=32260312345678000123650010000184781586515230|2|1|1|5992ACE793B70ECAB21096AC58B10FD49DACCAE2",
          "url_consulta_nf": "www.sefaz.es.gov.br/nfce/consulta",
          "requisicao_nota_fiscal": {
            "versao": "4.00",
            "chave_nfe": "NFe32260312345678000123650010000184781586515230",
            "uf": "32",
            "codigo_unico": "58651523",
            "natureza_operacao": "VENDA AO CONSUMIDOR",
            "modelo": "65",
            "serie": "1",
            "numero": "18478",
            "data_emissao": "2026-03-30T12:34:53-03:00",
            "tipo_documento": "1",
            "local_destino": "1",
            "municipio": "3201506",
            "formato_impressao": "4",
            "forma_emissao": "1",
            "digito_verificador": "0",
            "ambiente": "1",
            "finalidade_emissao": "1",
            "consumidor_final": "1",
            "presenca_comprador": "1",
            "indicador_intermediario": "0",
            "processo_emissao": "0",
            "versao_aplicativo": "0.1.0",
            "notas_referenciadas": [],
            "chaves_nfe_antecipacao_pagamento": [],
            "cnpj_emitente": "12345678000123",
            "nome_emitente": "RESTAURANTE EXEMPLO FICTICIO LTDA",
            "nome_fantasia_emitente": "Sabor Fictício",
            "logradouro_emitente": "Rua Cassiano Castelo",
            "numero_emitente": "248",
            "bairro_emitente": "Centro",
            "codigo_municipio_emitente": "3201506",
            "municipio_emitente": "Colatina",
            "uf_emitente": "ES",
            "cep_emitente": "29700060",
            "codigo_pais_emitente": "1058",
            "pais_emitente": "Brasil",
            "inscricao_estadual_emitente": "83552243",
            "regime_tributario_emitente": "1",
            "indicador_inscricao_estadual_destinatario": "9",
            "pessoas_autorizadas": [],
            "itens": [
              {
                "numero_item": "1",
                "codigo_produto": "396935",
                "codigo_barras_comercial": "SEM GTIN",
                "descricao": "CHOPP",
                "codigo_ncm": "22030000",
                "nves": [],
                "infos_credito_presumido": [],
                "cfop": "5405",
                "unidade_comercial": "UN",
                "quantidade_comercial": "2.0000",
                "valor_unitario_comercial": "12.99",
                "valor_bruto": "25.98",
                "codigo_barras_tributavel": "SEM GTIN",
                "unidade_tributavel": "UN",
                "quantidade_tributavel": "2.0000",
                "valor_unitario_tributavel": "12.99",
                "inclui_no_total": "1",
                "documentos_importacao": [],
                "detalhes_exportacao": [],
                "rastros": [],
                "armamentos": [],
                "origens_combustivel": [],
                "icms_percentual_partilha": "100.0000",
                "ibs_valor_total": null,
                "observacoes_contribuinte": [],
                "icms_origem": "0",
                "icms_situacao_tributaria": "500",
                "pis_situacao_tributaria": "04",
                "cofins_situacao_tributaria": "04"
              },
              {
                "numero_item": "2",
                "codigo_produto": "393512",
                "codigo_barras_comercial": "SEM GTIN",
                "descricao": "PAÇOCA",
                "codigo_ncm": "17049090",
                "nves": [],
                "infos_credito_presumido": [],
                "cfop": "5102",
                "unidade_comercial": "UN",
                "quantidade_comercial": "1.0000",
                "valor_unitario_comercial": "4.00",
                "valor_bruto": "4.00",
                "codigo_barras_tributavel": "SEM GTIN",
                "unidade_tributavel": "UN",
                "quantidade_tributavel": "1.0000",
                "valor_unitario_tributavel": "4.00",
                "inclui_no_total": "1",
                "documentos_importacao": [],
                "detalhes_exportacao": [],
                "rastros": [],
                "armamentos": [],
                "origens_combustivel": [],
                "icms_percentual_partilha": "100.0000",
                "ibs_valor_total": null,
                "observacoes_contribuinte": [],
                "icms_origem": "0",
                "icms_situacao_tributaria": "102",
                "pis_situacao_tributaria": "99",
                "pis_base_calculo": "0",
                "pis_aliquota_porcentual": "0",
                "pis_valor": "0",
                "cofins_situacao_tributaria": "99",
                "cofins_base_calculo": "0",
                "cofins_aliquota_porcentual": "0",
                "cofins_valor": "0"
              },
              {
                "numero_item": "3",
                "codigo_produto": "384186",
                "codigo_barras_comercial": "SEM GTIN",
                "descricao": "QUIBE VEGANO (CARDÁPIO DE BOTECO)",
                "codigo_ncm": "21069090",
                "nves": [],
                "infos_credito_presumido": [],
                "cfop": "5102",
                "unidade_comercial": "UN",
                "quantidade_comercial": "1.0000",
                "valor_unitario_comercial": "39.90",
                "valor_bruto": "39.90",
                "codigo_barras_tributavel": "SEM GTIN",
                "unidade_tributavel": "UN",
                "quantidade_tributavel": "1.0000",
                "valor_unitario_tributavel": "39.90",
                "inclui_no_total": "1",
                "documentos_importacao": [],
                "detalhes_exportacao": [],
                "rastros": [],
                "armamentos": [],
                "origens_combustivel": [],
                "icms_percentual_partilha": "100.0000",
                "ibs_valor_total": null,
                "observacoes_contribuinte": [],
                "icms_origem": "0",
                "icms_situacao_tributaria": "102",
                "pis_situacao_tributaria": "99",
                "pis_base_calculo": "0",
                "pis_aliquota_porcentual": "0",
                "pis_valor": "0",
                "cofins_situacao_tributaria": "99",
                "cofins_base_calculo": "0",
                "cofins_aliquota_porcentual": "0",
                "cofins_valor": "0"
              },
              {
                "numero_item": "4",
                "codigo_produto": "t10",
                "codigo_barras_comercial": "SEM GTIN",
                "descricao": "Taxa de Serviço (10.00%)",
                "codigo_ncm": "19059090",
                "nves": [],
                "infos_credito_presumido": [],
                "cfop": "5101",
                "unidade_comercial": "UN",
                "quantidade_comercial": "1.0000",
                "valor_unitario_comercial": "6.99",
                "valor_bruto": "6.99",
                "codigo_barras_tributavel": "SEM GTIN",
                "unidade_tributavel": "UN",
                "quantidade_tributavel": "1.0000",
                "valor_unitario_tributavel": "6.99",
                "inclui_no_total": "1",
                "documentos_importacao": [],
                "detalhes_exportacao": [],
                "rastros": [],
                "armamentos": [],
                "origens_combustivel": [],
                "icms_percentual_partilha": "100.0000",
                "ibs_valor_total": null,
                "observacoes_contribuinte": [],
                "icms_origem": "0",
                "icms_situacao_tributaria": "400"
              }
            ],
            "icms_base_calculo": "0",
            "icms_valor_total": "0",
            "icms_valor_total_desonerado": "0",
            "fcp_valor_total": "0",
            "icms_base_calculo_st": "0",
            "icms_valor_total_st": "0",
            "fcp_valor_total_st": "0",
            "fcp_valor_total_retido_st": "0",
            "valor_produtos": "76.87",
            "valor_frete": "0",
            "valor_seguro": "0",
            "valor_desconto": "0",
            "valor_total_ii": "0",
            "valor_ipi": "0",
            "valor_ipi_devolvido": "0",
            "valor_pis": "0",
            "valor_cofins": "0",
            "valor_outras_despesas": "0",
            "valor_total": "76.87",
            "ibs_cbs_is_valor_total": null,
            "modalidade_frete": "9",
            "reboques": [],
            "volumes": [],
            "duplicatas": [],
            "formas_pagamento": [
              {
                "forma_pagamento": "01",
                "valor_pagamento": "12.99",
                "tipo_integracao": null
              },
              {
                "forma_pagamento": "04",
                "valor_pagamento": "63.88",
                "tipo_integracao": "2",
                "bandeira_operadora": "01"
              }
            ],
            "observacoes_contribuinte": [],
            "observacoes_fisco": [],
            "processos_referenciados": [],
            "cana_fornecimentos": [],
            "cana_deducoes": [],
            "cnpj_responsavel_tecnico": "07504505000132",
            "contato_responsavel_tecnico": "Ricardo Exemplo Fictício",
            "email_responsavel_tecnico": "contato@exemplo-ficticio-doc.com.br",
            "telefone_responsavel_tecnico": "1111111111",
            "agropecuario_defensivo": [],
            "url_chave": "www.sefaz.es.gov.br/nfce/consulta"
          },
          "protocolo_nota_fiscal": {
            "versao": "4.00",
            "ambiente": "1",
            "versao_aplicativo": "SVRSnfce2512111137DR",
            "chave_nfe": "32260312345678000123650010000184781586515230",
            "data_recebimento": "2026-03-30T12:34:54-03:00",
            "numero_protocolo": "232260176682690",
            "digest_value": "eAgNYxffSjziGmIk0L4zKGz10qs=",
            "status": "100",
            "motivo": "Autorizado o uso da NF-e"
          }
        }
      },
      "ErroAutorizacaoResponse": {
        "value": {
          "cnpj_emitente": "12345678000123",
          "ref": "referencia_000899",
          "status": "erro_autorizacao",
          "status_sefaz": "704",
          "mensagem_sefaz": "Rejeição: NFC-e com Data-Hora de emissão atrasada"
        }
      },
      "CanceladaResponse": {
        "value": {
          "cnpj_emitente": "12345678000123",
          "ref": "referencia_000899",
          "status": "cancelado",
          "status_sefaz": "135",
          "mensagem_sefaz": "Evento registrado e vinculado a NF-e",
          "chave_nfe": "NFe41190612345678000123650010000000121743484310",
          "numero": "12",
          "serie": "1",
          "caminho_xml_nota_fiscal": "/arquivos_development/12345678000123/201906/XMLs/41190612345678000123650010000000121743484310-nfe.xml",
          "caminho_danfe": "/notas_fiscais_consumidor/NFe41190612345678000123650010000000121743484310.html",
          "caminho_xml_cancelamento": "/arquivos/12345678000123/202502/XMLs/3525020000076000150550020000030041206848679-cf-canc-06.xml"
        }
      }
    },
    "schemas": {
      "ErrorResponse": {
        "title": "Resposta de erro",
        "type": "object",
        "properties": {
          "codigo": {
            "type": "string",
            "description": "Código do erro"
          },
          "mensagem": {
            "type": "string",
            "description": "Mensagem descritiva"
          },
          "erros": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "mensagem": {
                  "type": "string"
                },
                "campo": {
                  "type": "string"
                }
              }
            }
          }
        }
      },
      "NFCeConsultaResponse": {
        "title": "Resposta consulta NFC-e",
        "type": "object",
        "description": "Mesmos campos da autorizada; status pode ser autorizado, erro_autorizacao ou denegado. Quando cancelada, veja o schema CanceladaResponse. Com completa=1 inclui requisicao_nota_fiscal, protocolo_nota_fiscal, etc.",
        "properties": {
          "cnpj_emitente": {
            "type": "string"
          },
          "ref": {
            "type": "string"
          },
          "status": {
            "type": "string",
            "enum": [
              "autorizado",
              "erro_autorizacao",
              "denegado"
            ]
          },
          "status_sefaz": {
            "type": "string"
          },
          "mensagem_sefaz": {
            "type": "string"
          },
          "chave_nfe": {
            "type": "string"
          },
          "numero": {
            "type": "string"
          },
          "serie": {
            "type": "string"
          },
          "caminho_xml_nota_fiscal": {
            "type": "string"
          },
          "caminho_danfe": {
            "type": "string"
          },
          "qrcode_url": {
            "type": "string"
          },
          "url_consulta_nf": {
            "type": "string"
          },
          "caminho_xml_cancelamento": {
            "type": "string"
          },
          "numero_protocolo": {
            "type": "string"
          }
        }
      },
      "CanceladaResponse": {
        "title": "NFC-e cancelada (consulta)",
        "type": "object",
        "properties": {
          "cnpj_emitente": {
            "type": "string",
            "description": "CNPJ do emitente"
          },
          "ref": {
            "type": "string",
            "description": "Referência da emissão"
          },
          "status": {
            "type": "string",
            "description": "Status da NFC-e",
            "enum": [
              "cancelado"
            ]
          },
          "status_sefaz": {
            "type": "string",
            "description": "Status na SEFAZ"
          },
          "mensagem_sefaz": {
            "type": "string",
            "description": "Mensagem descritiva da SEFAZ"
          },
          "chave_nfe": {
            "type": "string",
            "description": "Chave da NFC-e"
          },
          "numero": {
            "type": "string"
          },
          "serie": {
            "type": "string"
          },
          "caminho_xml_nota_fiscal": {
            "type": "string"
          },
          "caminho_danfe": {
            "type": "string"
          },
          "qrcode_url": {
            "type": "string"
          },
          "url_consulta_nf": {
            "type": "string"
          },
          "caminho_xml_cancelamento": {
            "type": "string",
            "description": "Caminho do XML de cancelamento"
          },
          "numero_protocolo": {
            "type": "string",
            "description": "Número do protocolo de cancelamento"
          }
        }
      },
      "ErroAutorizacaoResponse": {
        "title": "Erro autorização",
        "type": "object",
        "properties": {
          "cnpj_emitente": {
            "type": "string",
            "description": "CNPJ do emitente"
          },
          "ref": {
            "type": "string",
            "description": "Referência da emissão"
          },
          "status": {
            "type": "string",
            "description": "Status da NFC-e",
            "enum": [
              "erro_autorizacao"
            ]
          },
          "status_sefaz": {
            "type": "string",
            "description": "Status na SEFAZ"
          },
          "mensagem_sefaz": {
            "type": "string",
            "description": "Mensagem descritiva da SEFAZ"
          },
          "erros": {
            "type": "array",
            "description": "Lista de erros de validação ou rejeição",
            "items": {
              "$ref": "#/components/schemas/ErrorResponse"
            }
          }
        }
      }
    }
  }
}
```