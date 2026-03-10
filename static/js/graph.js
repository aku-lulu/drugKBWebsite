// 知识图谱管理
let network = null;
let nodes = new vis.DataSet([]);
let edges = new vis.DataSet([]);
let currentDrugId = null;
let suggestionTimeout = null;
let currentLayout = 'default';
let nodeCountHint = null;
let clusteredNodes = new Set(); // 记录被聚类的节点
let clusterInfo = {
    clusterId: null,
    childNodes: []
}; // 记录聚类信息

// 初始化页面
document.addEventListener('DOMContentLoaded', function() {
    initEventListeners();
    initGraph();
    addLayoutControls();
});

// 初始化事件监听
function initEventListeners() {
    // 搜索输入框 - 实时建议
    document.getElementById('searchInput').addEventListener('input', function() {
        clearTimeout(suggestionTimeout);
        const query = this.value.trim();

        if (query.length >= 2) {
            suggestionTimeout = setTimeout(() => {
                getSuggestions(query);
            }, 300);
        } else {
            document.getElementById('searchResults').innerHTML = '';
        }
    });

    // 搜索按钮点击
    document.getElementById('searchBtn').addEventListener('click', performSearch);

    // 搜索输入框回车
    document.getElementById('searchInput').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            performSearch();
        }
    });

    // 搜索类型改变
    document.getElementById('searchType').addEventListener('change', function() {
        document.getElementById('searchResults').innerHTML = '';
        document.getElementById('searchInput').value = '';
    });

    // 图谱控制
    document.getElementById('zoomIn').addEventListener('click', function() {
        if (network) network.moveTo({scale: network.getScale() * 1.2});
    });

    document.getElementById('zoomOut').addEventListener('click', function() {
        if (network) network.moveTo({scale: network.getScale() * 0.8});
    });

    document.getElementById('fitGraph').addEventListener('click', function() {
        if (network) network.fit();
    });
}

// 添加布局控制按钮
function addLayoutControls() {
    const controls = document.querySelector('.graph-controls');
    if (controls) {
        // 布局切换按钮
        const layoutBtn = document.createElement('button');
        layoutBtn.innerHTML = '切换布局';
        layoutBtn.title = '在默认布局和层次布局之间切换';
        layoutBtn.onclick = toggleLayout;
        controls.appendChild(layoutBtn);

        // 聚类按钮
        const clusterBtn = document.createElement('button');
        clusterBtn.innerHTML = '聚类';
        clusterBtn.title = '将相关节点聚合成簇';
        clusterBtn.onclick = clusterGraph;
        controls.appendChild(clusterBtn);

        // 展开全部按钮
        const expandBtn = document.createElement('button');
        expandBtn.innerHTML = '展开全部';
        expandBtn.title = '展开所有聚类节点';
        expandBtn.onclick = expandAllClusters;
        controls.appendChild(expandBtn);

        // 重置视图按钮
        const resetBtn = document.createElement('button');
        resetBtn.innerHTML = '重置';
        resetBtn.title = '重置视图';
        resetBtn.onclick = resetView;
        controls.appendChild(resetBtn);
    }
}

// 切换布局
function toggleLayout() {
    if (!network) return;

    if (currentLayout === 'default') {
        // 切换到层次布局
        network.setOptions({
            layout: {
                hierarchical: {
                    enabled: true,
                    direction: 'UD',
                    sortMethod: 'directed',
                    nodeSpacing: 150,
                    levelSeparation: 200,
                    edgeMinimization: true
                }
            },
            physics: {
                enabled: false
            }
        });
        currentLayout = 'hierarchical';
        showNotification('已切换到层次布局');
    } else {
        // 切换回默认布局
        network.setOptions({
            layout: {
                hierarchical: {
                    enabled: false
                }
            },
            physics: {
                enabled: true,
                stabilization: {
                    iterations: 100,
                    fit: true
                }
            }
        });
        currentLayout = 'default';
        showNotification('已切换到默认布局');
    }
    network.fit();
}

// 聚类函数
function clusterGraph() {
    if (!network) return;

    // 清除之前的聚类信息
    clusteredNodes.clear();
    clusterInfo = {
        clusterId: null,
        childNodes: []
    };

    // 获取所有相关节点
    const relatedNodes = [];
    nodes.forEach(node => {
        if (node.group === 'related') {
            relatedNodes.push(node.id);
        }
    });

    if (relatedNodes.length === 0) {
        showNotification('没有可聚类的相关节点');
        return;
    }

    // 生成唯一的聚类ID
    const clusterId = 'cluster_all';

    // 保存被聚类的节点ID
    const childNodeIds = relatedNodes;

    // 聚类选项
    const clusterOptions = {
        joinCondition: function(childNode) {
            return childNode.group === 'related';
        },
        clusterNodeProperties: {
            id: clusterId,
            label: `相关药物簇 (${relatedNodes.length})`,
            group: 'cluster',
            shape: 'box',
            size: 30,
            color: {
                background: '#3a4050',
                border: '#00bcd4',
                highlight: {
                    background: '#4a5060',
                    border: '#00bcd4'
                }
            },
            font: {
                color: '#e0e0e0',
                size: 12,
                bold: true
            },
            title: `包含 ${relatedNodes.length} 个相关药物\n点击展开查看`
        },
        clusterEdgeProperties: {
            color: '#00bcd4',
            width: 2,
            dashes: false
        }
    };

    // 执行聚类
    network.cluster(clusterOptions);

    // 保存聚类信息
    clusterInfo = {
        clusterId: clusterId,
        childNodes: childNodeIds
    };

    // 记录被聚类的节点
    childNodeIds.forEach(id => {
        clusteredNodes.add(id);
    });

    showNotification(`已聚类 ${relatedNodes.length} 个相关节点`);

    // 更新相互作用列表
    setTimeout(() => {
        updateInteractionsList(edges.get());
    }, 500);
}

// 展开聚类
function expandCluster() {
    if (!network) return false;

    // 检查是否有聚类
    if (!clusterInfo.clusterId) {
        showNotification('没有可展开的聚类');
        return false;
    }

    try {
        // 使用openCluster方法展开聚类
        network.openCluster(clusterInfo.clusterId);

        // 清除聚类信息
        clusteredNodes.clear();
        clusterInfo = {
            clusterId: null,
            childNodes: []
        };

        showNotification('已展开聚类');

        // 重新调整视图
        setTimeout(() => {
            network.fit();
            // 更新相互作用列表
            updateInteractionsList(edges.get());
        }, 500);

        return true;
    } catch (e) {
        console.error('展开聚类失败:', e);
        showNotification('展开聚类失败');
        return false;
    }
}

// 展开所有聚类
function expandAllClusters() {
    expandCluster();
}

// 重置视图
function resetView() {
    if (!network) return;

    // 先展开聚类
    expandCluster();

    // 重置布局
    setTimeout(() => {
        network.setOptions({
            layout: {
                hierarchical: {
                    enabled: false
                }
            },
            physics: {
                enabled: true,
                stabilization: true
            }
        });

        // 适应视图
        network.fit();
        currentLayout = 'default';
        showNotification('视图已重置');
    }, 600);
}

// 显示通知
function showNotification(message) {
    const notification = document.createElement('div');
    notification.className = 'graph-notification';
    notification.textContent = message;

    document.querySelector('.graph-card').appendChild(notification);

    setTimeout(() => {
        notification.remove();
    }, 2000);
}

// 获取搜索建议
function getSuggestions(query) {
    const searchType = document.getElementById('searchType').value;

    fetch(`/api/suggestions?type=${searchType}&q=${encodeURIComponent(query)}`)
        .then(response => response.json())
        .then(data => displaySuggestions(data))
        .catch(error => console.error('Suggestions error:', error));
}

// 显示搜索建议
function displaySuggestions(suggestions) {
    const container = document.getElementById('searchResults');

    if (suggestions.length === 0) {
        container.innerHTML = '<div class="result-item">无匹配结果</div>';
        return;
    }

    let html = '<div class="suggestions-header">搜索建议</div>';
    suggestions.forEach(suggestion => {
        let matchInfo = '';
        if (suggestion.matched_field === 'name') {
            matchInfo = `<span class="match-badge name-match">名称匹配</span>`;
        } else {
            matchInfo = `<span class="match-badge id-match">ID: ${suggestion.matched_value}</span>`;
        }

        const drugbankInfo = suggestion.drugbank_ids && suggestion.drugbank_ids.length > 0
            ? `<span class="drugbank-preview">${suggestion.drugbank_ids.join(', ')}</span>`
            : '';

        html += `
            <div class="result-item suggestion-item" onclick="selectDrug('${suggestion.id}')">
                <div class="name">${suggestion.name}</div>
                <div class="type">${suggestion.type} ${matchInfo}</div>
                <div class="desc">${drugbankInfo}</div>
            </div>
        `;
    });

    container.innerHTML = html;
}

// 执行搜索
function performSearch() {
    const searchType = document.getElementById('searchType').value;
    const query = document.getElementById('searchInput').value.trim();

    if (!query || query.length < 2) {
        document.getElementById('searchResults').innerHTML = '<div class="result-item">请输入至少2个字符</div>';
        return;
    }

    document.getElementById('searchResults').innerHTML = '<div class="result-item">搜索中...</div>';

    fetch(`/api/search?type=${searchType}&q=${encodeURIComponent(query)}`)
        .then(response => response.json())
        .then(data => displaySearchResults(data))
        .catch(error => {
            console.error('Search error:', error);
            document.getElementById('searchResults').innerHTML = '<div class="result-item">搜索出错，请重试</div>';
        });
}

// 显示搜索结果
function displaySearchResults(results) {
    const container = document.getElementById('searchResults');

    if (results.length === 0) {
        container.innerHTML = '<div class="result-item">未找到相关结果</div>';
        return;
    }

    let html = '<div class="suggestions-header">搜索结果</div>';
    results.forEach(result => {
        const drugbankIds = result.drugbank_ids || [];
        let drugbankHtml = '';
        if (drugbankIds.length > 0) {
            const displayIds = drugbankIds.slice(0, 3);
            drugbankHtml = '<span class="drugbank-preview">' + displayIds.join(', ') + '</span>';
            if (drugbankIds.length > 3) {
                drugbankHtml += ` <span class="drugbank-count">(+${drugbankIds.length - 3})</span>`;
            }
        }

        html += `
            <div class="result-item" onclick="selectDrug('${result.id}')">
                <div class="name">${result.name}</div>
                <div class="desc">${drugbankHtml}</div>
                <div class="desc">${result.description || ''}</div>
            </div>
        `;
    });

    container.innerHTML = html;
}

// 选择药物
function selectDrug(drugId) {
    currentDrugId = drugId;

    // 更新选中状态
    document.querySelectorAll('.result-item').forEach(item => {
        item.classList.remove('selected');
    });

    const selectedItem = Array.from(document.querySelectorAll('.result-item')).find(
        item => item.getAttribute('onclick')?.includes(drugId)
    );
    if (selectedItem) {
        selectedItem.classList.add('selected');
    }

    // 加载图谱
    loadGraph(drugId);

    // 加载分子信息
    loadMolecularInfo(drugId);

    // 更新当前选择信息
    updateSelectedInfo(drugId);
}

// 初始化图谱
function initGraph() {
    const container = document.getElementById('graph-container');

    const options = {
        nodes: {
            shape: 'dot',
            font: {
                color: '#e0e0e0',
                size: 12,
                face: 'Segoe UI',
                strokeWidth: 0
            },
            borderWidth: 2,
            shadow: true,
            scaling: {
                min: 10,
                max: 30,
                label: {
                    min: 8,
                    max: 14,
                    maxVisible: 20
                }
            }
        },
        edges: {
            width: 2,
            color: {
                color: '#4a4f5a',
                highlight: '#00bcd4',
                hover: '#00bcd4',
                opacity: 0.8
            },
            smooth: {
                type: 'curvedCW',
                roundness: 0.2
            },
            arrows: {
                to: {
                    enabled: false
                }
            }
        },
        physics: {
            stabilization: {
                iterations: 100,
                fit: true
            },
            barnesHut: {
                gravitationalConstant: -8000,
                centralGravity: 0.1,
                springLength: 200,
                springConstant: 0.04,
                damping: 0.09
            },
            maxVelocity: 50,
            minVelocity: 0.1
        },
        layout: {
            improvedLayout: true,
            hierarchical: {
                enabled: false
            }
        },
        interaction: {
            hover: true,
            tooltipDelay: 200,
            navigationButtons: true,
            keyboard: true,
            zoomView: true,
            dragView: true
        },
        groups: {
            center: {
                color: {
                    background: '#00bcd4',
                    border: '#ffffff',
                    highlight: {
                        background: '#00acc1',
                        border: '#ffffff'
                    }
                },
                size: 30,
                borderWidth: 3,
                font: {
                    size: 14,
                    color: '#ffffff',
                    bold: true
                },
                shape: 'star'
            },
            related: {
                color: {
                    background: '#2a2f3a',
                    border: '#4a4f5a',
                    highlight: {
                        background: '#3a3f4a',
                        border: '#00bcd4'
                    }
                },
                size: 20,
                font: {
                    size: 12,
                    color: '#e0e0e0'
                },
                shape: 'dot'
            },
            more: {
                color: {
                    background: '#4a4f5a',
                    border: '#8a8f99',
                    highlight: {
                        background: '#5a5f6a',
                        border: '#00bcd4'
                    }
                },
                size: 15,
                font: {
                    size: 11,
                    color: '#c0c0c0',
                    bold: true
                },
                shape: 'box'
            },
            cluster: {
                color: {
                    background: '#3a4050',
                    border: '#00bcd4',
                    highlight: {
                        background: '#4a5060',
                        border: '#00bcd4'
                    }
                },
                size: 25,
                font: {
                    size: 12,
                    color: '#e0e0e0',
                    bold: true
                },
                shape: 'box'
            }
        }
    };

    network = new vis.Network(container, { nodes, edges }, options);

    // 节点点击事件
    network.on('click', function(params) {
        if (params.nodes.length > 0) {
            const nodeId = params.nodes[0];
            const node = nodes.get(nodeId);

            if (node) {
                if (node.group === 'more') {
                    // 点击"更多"节点，显示提示
                    if (confirm('有更多未显示的相互作用关系，是否加载全部？')) {
                        loadFullGraph(currentDrugId);
                    }
                } else if (node.group === 'related') {
                    selectDrug(nodeId);
                } else if (node.group === 'cluster') {
                    // 点击聚类节点，展开
                    expandCluster();
                }
            }
        }
    });

    // 双击节点
    network.on('doubleClick', function(params) {
        if (params.nodes.length > 0) {
            const nodeId = params.nodes[0];
            const node = nodes.get(nodeId);

            if (node) {
                if (node.group === 'more') {
                    // 双击"更多"节点，加载全部
                    loadFullGraph(currentDrugId);
                } else if (node.group === 'cluster') {
                    // 双击聚类节点，展开
                    expandCluster();
                } else if (node.group === 'related') {
                    // 双击相关节点，也可以选择跳转
                    selectDrug(nodeId);
                }
            }
        }
    });

    // 节点悬停
    network.on('hoverNode', function(params) {
        const node = nodes.get(params.node);
        if (node) {
            if (node.group === 'more' || node.group === 'cluster') {
                network.canvas.body.container.style.cursor = 'pointer';
            } else {
                network.canvas.body.container.style.cursor = 'pointer';
            }
        }
    });

    network.on('blurNode', function(params) {
        network.canvas.body.container.style.cursor = 'default';
    });

    // 稳定后调整视图
    network.once('stabilized', function() {
        network.fit();
    });
}

// 加载图谱数据
function loadGraph(drugId) {
    document.getElementById('graph-container').innerHTML = '<div class="graph-loading">加载相互作用图谱中...</div>';

    // 清除聚类记录
    clusteredNodes.clear();
    clusterInfo = {
        clusterId: null,
        childNodes: []
    };

    fetch(`/api/graph/${drugId}`)
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                document.getElementById('graph-container').innerHTML = `<div class="graph-error">错误: ${data.error}</div>`;
                return;
            }

            // 重新初始化图谱
            initGraph();

            // 清空数据
            nodes.clear();
            edges.clear();

            // 添加节点
            if (data.nodes && data.nodes.length > 0) {
                nodes.add(data.nodes);
            }

            // 添加边
            if (data.edges && data.edges.length > 0) {
                edges.add(data.edges);
            }

            // 更新标题
            const graphHeader = document.querySelector('.graph-card .card-header h2');
            if (graphHeader) {
                if (data.displayed_interactions > 0) {
                    graphHeader.innerHTML = `药物相互作用图谱: ${data.drug_name} <span class="graph-stats">(显示 ${data.displayed_interactions}/${data.total_interactions} 个相互作用)</span>`;
                } else {
                    graphHeader.innerHTML = `药物相互作用图谱: ${data.drug_name} <span class="graph-stats no-data">(无相互作用数据)</span>`;
                }
            }

            // 添加节点计数提示
            addNodeCountHint(data);

            // 高亮中心节点
            if (data.center_id) {
                setTimeout(() => {
                    network.selectNodes([data.center_id]);
                    network.focus(data.center_id, {
                        scale: 1.2,
                        animation: {
                            duration: 500,
                            easingFunction: 'easeInOutQuad'
                        }
                    });
                }, 500);
            }

            // 更新相互作用列表
            updateInteractionsList(data.edges);
        })
        .catch(error => {
            console.error('Load graph error:', error);
            document.getElementById('graph-container').innerHTML = '<div class="graph-error">加载图谱失败</div>';
        });
}

// 加载完整图谱
function loadFullGraph(drugId) {
    document.getElementById('graph-container').innerHTML = '<div class="graph-loading">加载全部相互作用中...</div>';

    // 清除聚类记录
    clusteredNodes.clear();
    clusterInfo = {
        clusterId: null,
        childNodes: []
    };

    fetch(`/api/graph/${drugId}?full=true`)
        .then(response => response.json())
        .then(data => {
            if (data.error) return;

            initGraph();
            nodes.clear();
            edges.clear();

            if (data.nodes) nodes.add(data.nodes);
            if (data.edges) edges.add(data.edges);

            const graphHeader = document.querySelector('.graph-card .card-header h2');
            if (graphHeader && data.drug_name) {
                graphHeader.innerHTML = `药物相互作用图谱: ${data.drug_name} <span class="graph-stats">(全部 ${data.total_interactions} 个相互作用)</span>`;
            }

            if (data.center_id) {
                network.focus(data.center_id, {
                    scale: 1.2,
                    animation: true
                });
            }

            updateInteractionsList(data.edges);
        });
}

// 添加节点计数提示
function addNodeCountHint(data) {
    // 移除旧的提示
    if (nodeCountHint) {
        nodeCountHint.remove();
    }

    // 创建新的提示
    nodeCountHint = document.createElement('div');
    nodeCountHint.className = 'node-count-hint';
    nodeCountHint.innerHTML = `
        <span>节点: ${data.nodes.length} | 边: ${data.edges.length}</span>
        ${data.has_more ? `<span class="more-hint"> | 还有 ${data.remaining_count} 个未显示 (双击"更多"节点查看)</span>` : ''}
        ${clusterInfo.clusterId ? `<span class="more-hint"> | 已聚类 (点击展开)</span>` : ''}
    `;

    document.querySelector('.graph-card').appendChild(nodeCountHint);
}

// 加载分子信息
function loadMolecularInfo(drugId) {
    fetch(`/api/drug/${drugId}/molecular_info`)
        .then(response => response.json())
        .then(data => {
            if (data.error) return;

            document.getElementById('mol-name').textContent = data.name || '-';
            const drugbankElement = document.getElementById('mol-drugbank-ids');
            if (drugbankElement) {
                drugbankElement.textContent = data.drugbank_ids ? data.drugbank_ids.join(', ') : '-';
            }
            document.getElementById('mol-cas').textContent = data.cas_number || '-';
            document.getElementById('mol-uni').textContent = data.uni || '-';
            document.getElementById('mol-state').textContent = data.state || '-';
            document.getElementById('mol-groups').textContent = data.groups ? data.groups.join(', ') : '-';

            const descElement = document.getElementById('mol-description');
            if (descElement) {
                const p = descElement.querySelector('p') || document.createElement('p');
                p.textContent = data.description || '暂无描述';
                if (!descElement.querySelector('p')) descElement.appendChild(p);
            }
        })
        .catch(error => console.error('Load molecular info error:', error));
}

// 更新当前选择信息
function updateSelectedInfo(drugId) {
    fetch(`/api/drug/${drugId}`)
        .then(response => response.json())
        .then(data => {
            const container = document.querySelector('.selected-info .info-content');
            if (data.error) {
                container.innerHTML = '<p class="placeholder">信息加载失败</p>';
                return;
            }

            let groups = data.groups ? data.groups.join(', ') : 'N/A';
            let drugbankIds = data.drugbank_ids ? data.drugbank_ids.join(', ') : 'N/A';

            container.innerHTML = `
                <div class="info-item"><span class="label">名称:</span><span class="value">${data.name || 'N/A'}</span></div>
                <div class="info-item"><span class="label">DrugBank IDs:</span><span class="value">${drugbankIds}</span></div>
                <div class="info-item"><span class="label">CAS号:</span><span class="value">${data.cas_number || 'N/A'}</span></div>
                <div class="info-item"><span class="label">UNI:</span><span class="value">${data.uni || 'N/A'}</span></div>
                <div class="info-item"><span class="label">状态:</span><span class="value">${data.state || 'N/A'}</span></div>
                <div class="info-item"><span class="label">分组:</span><span class="value">${groups}</span></div>
            `;
        })
        .catch(error => console.error('Update selected info error:', error));
}

// 更新相互作用列表
function updateInteractionsList(edges) {
    const container = document.getElementById('interactionsList');

    if (!edges || edges.length === 0) {
        container.innerHTML = '<p class="placeholder">该药物暂无相互作用数据</p>';
        return;
    }

    let html = '';
    let displayedCount = 0;

    // 检查是否有聚类
    const hasCluster = clusterInfo.clusterId !== null;

    if (hasCluster) {
        // 如果有聚类，显示提示
        container.innerHTML = '<p class="placeholder">节点已被聚类，请点击聚类节点展开查看详细信息</p>';
        return;
    }

    edges.forEach(edge => {
        // 跳过"更多"节点
        if (edge.to && edge.to.toString().startsWith('more_')) {
            return;
        }

        const targetNode = nodes.get(edge.to);
        if (!targetNode) return;

        displayedCount++;
        const drugName = targetNode.label || '未知药物';
        const description = edge.title || '相互作用描述';

        html += `
            <div class="interaction-item">
                <div class="drug-name">${drugName}</div>
                <div class="description">${description}</div>
            </div>
        `;
    });

    if (displayedCount === 0) {
        container.innerHTML = '<p class="placeholder">该药物暂无相互作用数据</p>';
    } else {
        container.innerHTML = html;
    }
}